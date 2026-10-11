import "server-only";
import { db } from "@/lib/db/supabase";
import type { Json } from "@/lib/db/database.types";
import { env } from "@/lib/env";
import { openai } from "@/lib/openai";
import { executeTool } from "@/lib/agent/execute";
import { runAgentTurn, type Action, type HistoryMessage, type TurnEvent, TurnDeadlineError } from "@/lib/agent/loop";
import { buildSystemPrompt, type ConversationState, type CustomerFacts } from "@/lib/agent/prompt";
import { formatHuman } from "@/lib/agent/time";
import { toolDefinitions } from "@/lib/agent/tools";
import type { Source } from "@/lib/rag/retrieve";

// One customer message, end to end (design §7, §7.1): conversation, memory,
// the agent loop, persistence and retries. The browser sends only
// { sessionId, clientMessageId, message }; history is always loaded here, so
// a client can't forge assistant turns.

// Working memory: the last N user/assistant messages (design §7). Older turns
// are not sent, to bound cost; the customer's details survive via facts.
export const HISTORY_LIMIT = 20;

// A user message with no reply younger than this is assumed to be still
// running (design §7.1). Longer than the turn deadline (45 s).
export const IN_PROGRESS_WINDOW_MS = 60_000;

export type ChatEvent =
  | { type: "start"; userMessageId: number }
  | TurnEvent
  | { type: "sources"; sources: Source[] }
  | { type: "done"; messageId: number; replayed?: boolean }
  | { type: "error"; message: string; retryable: boolean };

export class ChatHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const AI_UNAVAILABLE = "I'm having trouble responding right now. Please try again in a moment.";

interface Business {
  id: string;
  name: string;
  description: string;
  timezone: string;
}

const BUSINESS_TTL_MS = 60_000;
let businessCache: { value: Business; expires: number } | undefined;

export async function demoBusiness(): Promise<Business> {
  if (businessCache && businessCache.expires > Date.now()) return businessCache.value;
  const { data, error } = await db()
    .from("businesses")
    .select("id, name, description, timezone")
    .eq("slug", env().DEMO_BUSINESS_SLUG)
    .maybeSingle();
  if (error) throw new Error(`Loading business failed: ${error.message}`);
  if (!data) throw new ChatHttpError(503, "The assistant isn't set up yet.");
  businessCache = { value: data, expires: Date.now() + BUSINESS_TTL_MS };
  return data;
}

// Race-safe get-or-create (design Q2): two tabs opening at once both end up
// with the same row.
async function conversationFor(businessId: string, sessionId: string) {
  const { error: insertError } = await db()
    .from("conversations")
    .upsert({ business_id: businessId, session_id: sessionId }, { onConflict: "business_id,session_id", ignoreDuplicates: true });
  if (insertError) throw new Error(`Creating conversation failed: ${insertError.message}`);
  const { data, error } = await db()
    .from("conversations")
    .select("id, customer_facts, lead_id")
    .eq("business_id", businessId)
    .eq("session_id", sessionId)
    .single();
  if (error) throw new Error(`Loading conversation failed: ${error.message}`);
  return data;
}

// ---------------------------------------------------------------------------
// Retries (design §7.1)
// ---------------------------------------------------------------------------

export interface StoredReply {
  id: number;
  content: string | null;
  sources: Json;
  actions: Json;
}

export type RetryDecision = { kind: "replay"; reply: StoredReply } | { kind: "in_progress" } | { kind: "rerun" };

// Pure, so the rules are unit-tested.
export function decideRetry(
  userMessage: { created_at: string; reply_failed_at: string | null },
  reply: StoredReply | null,
  now: Date,
): RetryDecision {
  if (reply) return { kind: "replay", reply };
  if (userMessage.reply_failed_at) return { kind: "rerun" };
  const age = now.getTime() - new Date(userMessage.created_at).getTime();
  return age < IN_PROGRESS_WINDOW_MS ? { kind: "in_progress" } : { kind: "rerun" };
}

// ---------------------------------------------------------------------------
// The turn
// ---------------------------------------------------------------------------

export interface ChatTurnInput {
  sessionId: string;
  clientMessageId: string;
  message: string;
}

// Throws ChatHttpError before any event is emitted (bad request, in
// progress). After the first event, failures are reported as an error event.
export async function prepareChatTurn(input: ChatTurnInput) {
  const business = await demoBusiness();
  const conversation = await conversationFor(business.id, input.sessionId);

  let userMessageId: number;
  const { data: inserted, error } = await db()
    .from("messages")
    .insert({ conversation_id: conversation.id, client_message_id: input.clientMessageId, role: "user", channel: "text", content: input.message })
    .select("id")
    .single();

  if (!error) {
    userMessageId = inserted.id;
  } else if (error.message.includes("messages_conversation_id_client_message_id_key")) {
    // A retry of a message we already have.
    const { data: existing } = await db()
      .from("messages")
      .select("id, created_at, reply_failed_at")
      .eq("conversation_id", conversation.id)
      .eq("client_message_id", input.clientMessageId)
      .single();
    const { data: reply } = await db()
      .from("messages")
      .select("id, content, sources, actions")
      .eq("reply_to_message_id", existing!.id)
      .maybeSingle();
    const decision = decideRetry(existing!, reply, new Date());
    if (decision.kind === "in_progress") throw new ChatHttpError(409, "This message is still being answered.");
    if (decision.kind === "replay") return { kind: "replay" as const, userMessageId: existing!.id, reply: decision.reply };
    userMessageId = existing!.id;
    await db().from("messages").update({ reply_failed_at: null }).eq("id", userMessageId);
  } else {
    throw new Error(`Saving message failed: ${error.message}`);
  }

  return { kind: "run" as const, business, conversation, userMessageId };
}

export async function runChatTurn(prepared: Extract<Awaited<ReturnType<typeof prepareChatTurn>>, { kind: "run" }>, input: ChatTurnInput, emit: (e: ChatEvent) => void) {
  const { business, conversation, userMessageId } = prepared;
  const started = Date.now();
  emit({ type: "start", userMessageId });

  // History before this message (the current one is passed separately).
  const { data: rows, error: historyError } = await db()
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversation.id)
    .not("content", "is", null)
    .lt("id", userMessageId)
    .order("id", { ascending: false })
    .limit(HISTORY_LIMIT - 1);
  if (historyError) throw new Error(`Loading history failed: ${historyError.message}`);
  const history: HistoryMessage[] = (rows ?? []).reverse().map((r) => ({ role: r.role as HistoryMessage["role"], content: r.content! }));

  const facts = (conversation.customer_facts ?? {}) as CustomerFacts;
  const now = new Date();

  // Live from the database, so a request staff confirmed or cancelled shows
  // its current status.
  const { data: requests, error: requestsError } = await db()
    .from("consultation_requests")
    .select("service, preferred_at, status")
    .eq("conversation_id", conversation.id)
    .order("created_at");
  if (requestsError) throw new Error(`Loading requests failed: ${requestsError.message}`);
  const state: ConversationState = {
    contactSaved: conversation.lead_id !== null,
    requests: (requests ?? []).map((r) => ({ service: r.service, preferredTime: formatHuman(new Date(r.preferred_at), business.timezone), status: r.status })),
  };

  try {
    const result = await runAgentTurn(
      {
        model: env().OPENAI_CHAT_MODEL,
        system: buildSystemPrompt({ business, now, channel: "text", customerFacts: facts, state }),
        history,
        userText: input.message,
        tools: toolDefinitions(),
        toolCtx: { businessId: business.id, conversationId: conversation.id, channel: "text", timeZone: business.timezone, now: () => new Date() },
        emit,
      },
      {
        complete: (params, signal) => openai().chat.completions.create(params, { signal }),
        executeTool,
      },
    );

    const { data: saved, error: saveError } = await db()
      .from("messages")
      .insert({
        conversation_id: conversation.id,
        role: "assistant",
        channel: "text",
        content: result.text,
        sources: result.sources as unknown as NonNullable<Json>,
        actions: result.actions as unknown as NonNullable<Json>,
        reply_to_message_id: userMessageId,
      })
      .select("id")
      .single();

    let messageId: number;
    if (saveError?.message.includes("messages_reply_to_message_id_key")) {
      // A concurrent duplicate run stored its reply first; that one stands.
      const { data: winner } = await db().from("messages").select("id").eq("reply_to_message_id", userMessageId).single();
      messageId = winner!.id;
    } else if (saveError) {
      throw new Error(`Saving reply failed: ${saveError.message}`);
    } else {
      messageId = saved.id;
    }

    emit({ type: "sources", sources: result.sources });
    emit({ type: "done", messageId });
    log({ outcome: "ok", conversationId: conversation.id, ms: Date.now() - started, rounds: result.rounds, tools: result.toolCalls, usage: result.usage });
  } catch (err) {
    await db().from("messages").update({ reply_failed_at: new Date().toISOString() }).eq("id", userMessageId);
    const outcome = err instanceof TurnDeadlineError ? "deadline" : "error";
    log({ outcome, conversationId: conversation.id, ms: Date.now() - started, error: err instanceof Error ? err.message : String(err) });
    emit({ type: "error", message: AI_UNAVAILABLE, retryable: true });
  }
}

export function replayEvents(userMessageId: number, reply: StoredReply): ChatEvent[] {
  const events: ChatEvent[] = [{ type: "start", userMessageId }];
  for (const action of (reply.actions ?? []) as unknown as Action[]) events.push({ type: "action", action });
  events.push({ type: "delta", text: reply.content ?? "" });
  events.push({ type: "sources", sources: (reply.sources ?? []) as unknown as Source[] });
  events.push({ type: "done", messageId: reply.id, replayed: true });
  return events;
}

// One structured line per turn: enough to answer "what happened to this
// customer's message" without a debugger (design: observability).
function log(fields: Record<string, unknown>) {
  console.log(JSON.stringify({ event: "chat_turn", ...fields }));
}

// ---------------------------------------------------------------------------
// History for the UI
// ---------------------------------------------------------------------------

export async function loadHistory(sessionId: string) {
  const business = await demoBusiness();
  const { data: conversation } = await db()
    .from("conversations")
    .select("id")
    .eq("business_id", business.id)
    .eq("session_id", sessionId)
    .maybeSingle();
  if (!conversation) return [];
  const { data, error } = await db()
    .from("messages")
    .select("id, role, channel, content, sources, actions, created_at, reply_failed_at")
    .eq("conversation_id", conversation.id)
    .order("id", { ascending: true })
    .limit(200);
  if (error) throw new Error(`Loading history failed: ${error.message}`);
  return (data ?? []).map((m) => ({
    id: m.id,
    role: m.role,
    channel: m.channel,
    content: m.content,
    sources: m.sources,
    actions: m.actions,
    createdAt: m.created_at,
    replyFailed: m.reply_failed_at !== null,
  }));
}
