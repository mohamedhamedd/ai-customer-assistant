import "server-only";
import { db } from "@/lib/db/supabase";
import type { Json } from "@/lib/db/database.types";
import { env } from "@/lib/env";
import { openai } from "@/lib/openai";
import { executeTool } from "@/lib/agent/execute";
import { runAgentTurn, type Action, type AgentDeps, type HistoryMessage, type TurnEvent, type TurnResult, TurnDeadlineError } from "@/lib/agent/loop";
import { buildSystemPrompt, type ConversationState, type CustomerFacts } from "@/lib/agent/prompt";
import { formatHuman } from "@/lib/agent/time";
import { isBusinessSlug } from "@/lib/chat/limits";
import { toolDefinitions } from "@/lib/agent/tools";
import type { Source } from "@/lib/rag/retrieve";

// One customer message, end to end (design §7, §7.1): conversation, memory,
// the agent loop, persistence and retries. The browser sends only
// { sessionId, clientMessageId, message }; history is always loaded here, so
// a client can't forge assistant turns.

// Working memory: the last N user/assistant messages (design §7). Older turns
// are not sent, to bound cost; the customer's details survive via facts.
export const HISTORY_LIMIT = 20;

// Messages returned to the UI on load: the most recent ones.
export const HISTORY_PAGE = 200;

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

export interface Business {
  id: string;
  slug: string;
  name: string;
  description: string;
  timezone: string;
}

// Each chat page serves one business, picked by the slug in its URL
// (/b/[slug], decision D-14). Cached briefly per slug: every message needs it,
// and a business's profile rarely changes.
//
// Only businesses that exist are cached, so the cache is bounded by the
// number of businesses: a stream of made-up slugs from the internet can't
// grow it, and a business created a moment ago is found at once.
const BUSINESS_TTL_MS = 60_000;
const businessCache = new Map<string, { value: Business; expires: number }>();

export async function findBusiness(slug: string): Promise<Business | null> {
  if (!isBusinessSlug(slug)) return null;
  const hit = businessCache.get(slug);
  if (hit && hit.expires > Date.now()) return hit.value;
  const { data, error } = await db()
    .from("businesses")
    .select("id, slug, name, description, timezone")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`Loading business failed: ${error.message}`);
  if (data) businessCache.set(slug, { value: data, expires: Date.now() + BUSINESS_TTL_MS });
  else businessCache.delete(slug);
  return data;
}

export const UNKNOWN_BUSINESS = "This assistant doesn't exist.";

async function requireBusiness(slug: string): Promise<Business> {
  const business = await findBusiness(slug);
  if (!business) throw new ChatHttpError(404, UNKNOWN_BUSINESS);
  return business;
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

// Pure, so the rules are unit-tested. "rerun" is only a candidate: the
// caller must still win claim_reply_attempt(), which makes the same check
// atomically so two concurrent retries can't both run the turn.
export function decideRetry(
  userMessage: { reply_attempt_at: string; reply_failed_at: string | null },
  reply: StoredReply | null,
  now: Date,
): RetryDecision {
  if (reply) return { kind: "replay", reply };
  if (userMessage.reply_failed_at) return { kind: "rerun" };
  // Measured from the latest attempt, not from when the message was sent: a
  // re-run of an old message is "in progress" for its own window.
  const age = now.getTime() - new Date(userMessage.reply_attempt_at).getTime();
  return age < IN_PROGRESS_WINDOW_MS ? { kind: "in_progress" } : { kind: "rerun" };
}

// ---------------------------------------------------------------------------
// The turn
// ---------------------------------------------------------------------------

export interface ChatTurnInput {
  businessSlug: string;
  sessionId: string;
  clientMessageId: string;
  message: string;
}

const IN_PROGRESS_MESSAGE = "This message is still being answered.";
export const BUSY_MESSAGE = "I'm still answering your previous message. Please wait a moment.";

async function storedReply(userMessageId: number): Promise<StoredReply | null> {
  const { data, error } = await db()
    .from("messages")
    .select("id, content, sources, actions")
    .eq("reply_to_message_id", userMessageId)
    .maybeSingle();
  if (error) throw new Error(`Loading reply failed: ${error.message}`);
  return data;
}

// Throws ChatHttpError before any event is emitted (bad request, in
// progress). After the first event, failures are reported as an error event.
export async function prepareChatTurn(input: ChatTurnInput) {
  const business = await requireBusiness(input.businessSlug);
  const conversation = await conversationFor(business.id, input.sessionId);

  // One turn at a time per conversation (the SQL function locks the
  // conversation row): a second message while the first is still being
  // answered gets a 409 instead of running on stale history and state.
  const { data: begun, error: beginError } = await db().rpc("begin_user_message", {
    p_conversation_id: conversation.id,
    p_client_message_id: input.clientMessageId,
    p_content: input.message,
    p_window_seconds: IN_PROGRESS_WINDOW_MS / 1000,
  });
  if (beginError) throw new Error(`Saving message failed: ${beginError.message}`);
  const result = begun as { status: "created" | "exists" | "busy"; message_id?: number };
  if (result.status === "busy") throw new ChatHttpError(409, BUSY_MESSAGE);
  if (result.status === "created") return { kind: "run" as const, business, conversation, userMessageId: result.message_id! };

  // A retry of a message we already have (design §7.1).
  const { data: existing, error: existingError } = await db()
    .from("messages")
    .select("id, reply_attempt_at, reply_failed_at")
    .eq("id", result.message_id!)
    .single();
  if (existingError) throw new Error(`Loading message failed: ${existingError.message}`);
  const decision = decideRetry(existing, await storedReply(existing.id), new Date());
  if (decision.kind === "in_progress") throw new ChatHttpError(409, IN_PROGRESS_MESSAGE);
  if (decision.kind === "replay") return { kind: "replay" as const, userMessageId: existing.id, reply: decision.reply };

  const { data: claimed, error: claimError } = await db().rpc("claim_reply_attempt", {
    p_message_id: existing.id,
    p_window_seconds: IN_PROGRESS_WINDOW_MS / 1000,
  });
  if (claimError) throw new Error(`Claiming retry failed: ${claimError.message}`);
  if (!claimed) {
    // Another retry claimed it first, its reply landed meanwhile, or another
    // turn in this conversation is running.
    const late = await storedReply(existing.id);
    if (late) return { kind: "replay" as const, userMessageId: existing.id, reply: late };
    throw new ChatHttpError(409, IN_PROGRESS_MESSAGE);
  }
  const userMessageId = existing.id;

  return { kind: "run" as const, business, conversation, userMessageId };
}

export const REPLY_NOT_SAVED = "That answer couldn't be saved, so it may not appear if you reload the page.";

export interface ChatTurnDeps {
  complete: AgentDeps["complete"];
}

const defaultTurnDeps: ChatTurnDeps = {
  complete: (params, signal) => openai().chat.completions.create(params, { signal }),
};

export async function runChatTurn(
  prepared: Extract<Awaited<ReturnType<typeof prepareChatTurn>>, { kind: "run" }>,
  input: ChatTurnInput,
  emit: (e: ChatEvent) => void,
  deps: ChatTurnDeps = defaultTurnDeps,
) {
  const { business, conversation, userMessageId } = prepared;
  const started = Date.now();
  emit({ type: "start", userMessageId });

  // Everything from here on is covered: any failure marks the turn failed, so
  // a retry re-runs at once instead of waiting out the in-progress window.
  let result: TurnResult;
  try {
    // Independent reads, in parallel: both sit before the first model call.
    const [history, state] = await Promise.all([recentHistory(conversation.id, userMessageId), conversationState(conversation, business.timezone)]);
    result = await runAgentTurn(
      {
        model: env().OPENAI_CHAT_MODEL,
        system: buildSystemPrompt({ business, now: new Date(), channel: "text", customerFacts: (conversation.customer_facts ?? {}) as CustomerFacts, state }),
        history,
        userText: input.message,
        tools: toolDefinitions(),
        toolCtx: { businessId: business.id, conversationId: conversation.id, channel: "text", timeZone: business.timezone, now: () => new Date() },
        emit,
      },
      { complete: deps.complete, executeTool },
    );
  } catch (err) {
    await markFailed(userMessageId);
    log({ outcome: err instanceof TurnDeadlineError ? "deadline" : "error", conversationId: conversation.id, ms: Date.now() - started, error: errorText(err) });
    emit({ type: "error", message: AI_UNAVAILABLE, retryable: true });
    return;
  }

  // The customer has now read the whole answer. Saving it gets one retry; if
  // it still fails, say so plainly instead of inviting a retry that would run
  // the model again and show a different answer.
  let messageId: number;
  try {
    messageId = await withOneRetry(() => saveReply(conversation.id, userMessageId, result));
  } catch (err) {
    await markFailed(userMessageId);
    log({ outcome: "save_failed", conversationId: conversation.id, ms: Date.now() - started, error: errorText(err) });
    emit({ type: "error", message: REPLY_NOT_SAVED, retryable: false });
    return;
  }

  emit({ type: "sources", sources: result.sources });
  emit({ type: "done", messageId });
  log({ outcome: "ok", conversationId: conversation.id, ms: Date.now() - started, rounds: result.rounds, tools: result.toolCalls, usage: result.usage });
}

// History before this message (the current one is passed separately).
async function recentHistory(conversationId: string, userMessageId: number): Promise<HistoryMessage[]> {
  const { data, error } = await db()
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .not("content", "is", null)
    .lt("id", userMessageId)
    .order("id", { ascending: false })
    .limit(HISTORY_LIMIT - 1);
  if (error) throw new Error(`Loading history failed: ${error.message}`);
  return (data ?? []).reverse().map((r) => ({ role: r.role as HistoryMessage["role"], content: r.content! }));
}

// Live from the database, so a request staff confirmed or cancelled shows its
// current status.
async function conversationState(conversation: { id: string; lead_id: string | null }, timeZone: string): Promise<ConversationState> {
  const { data, error } = await db()
    .from("consultation_requests")
    .select("service, preferred_at, status")
    .eq("conversation_id", conversation.id)
    .order("created_at");
  if (error) throw new Error(`Loading requests failed: ${error.message}`);
  return {
    contactSaved: conversation.lead_id !== null,
    requests: (data ?? []).map((r) => ({ service: r.service, preferredTime: formatHuman(new Date(r.preferred_at), timeZone), status: r.status })),
  };
}

async function saveReply(conversationId: string, userMessageId: number, result: TurnResult): Promise<number> {
  const { data, error } = await db()
    .from("messages")
    .insert({
      conversation_id: conversationId,
      role: "assistant",
      channel: "text",
      content: result.text,
      sources: result.sources as unknown as NonNullable<Json>,
      actions: result.actions as unknown as NonNullable<Json>,
      reply_to_message_id: userMessageId,
    })
    .select("id")
    .single();
  if (!error) return data.id;
  if (error.message.includes("messages_reply_to_message_id_key")) {
    // A concurrent run stored its reply first; that one stands.
    const winner = await storedReply(userMessageId);
    if (winner) return winner.id;
  }
  throw new Error(`Saving reply failed: ${error.message}`);
}

async function withOneRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    await new Promise((r) => setTimeout(r, 300));
    return fn();
  }
}

// Best effort: if the database is down this fails too, and the in-progress
// window becomes the fallback.
async function markFailed(userMessageId: number) {
  try {
    await db().from("messages").update({ reply_failed_at: new Date().toISOString() }).eq("id", userMessageId);
  } catch (err) {
    console.error("[chat] could not mark turn failed", err);
  }
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

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

export async function loadHistory(businessSlug: string, sessionId: string) {
  const business = await requireBusiness(businessSlug);
  const { data: conversation } = await db()
    .from("conversations")
    .select("id")
    .eq("business_id", business.id)
    .eq("session_id", sessionId)
    .maybeSingle();
  if (!conversation) return [];
  const { data, error } = await db()
    .from("messages")
    .select("id, role, channel, content, sources, actions, created_at, reply_failed_at, client_message_id")
    .eq("conversation_id", conversation.id)
    // The newest messages (reversed below so they read oldest first).
    .order("id", { ascending: false })
    .limit(HISTORY_PAGE);
  if (error) throw new Error(`Loading history failed: ${error.message}`);
  return (data ?? []).reverse().map((m) => ({
    id: m.id,
    role: m.role,
    channel: m.channel,
    content: m.content,
    sources: m.sources,
    actions: m.actions,
    createdAt: m.created_at,
    replyFailed: m.reply_failed_at !== null,
    // The browser generated it; returned so a failed last message can still
    // be retried (same id) after a reload.
    clientMessageId: m.client_message_id,
  }));
}
