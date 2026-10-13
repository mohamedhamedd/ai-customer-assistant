import "server-only";
import { db } from "@/lib/db/supabase";
import type { Json } from "@/lib/db/database.types";
import { env } from "@/lib/env";
import { openai } from "@/lib/openai";
import { executeTool } from "@/lib/agent/execute";
import { runAgentTurn, type Action, type AgentDeps, type HistoryMessage, type TurnEvent, type TurnResult, TurnDeadlineError } from "@/lib/agent/loop";
import { buildSystemPrompt, promptFacts, type BusinessTables, type ConversationState, type CustomerFacts } from "@/lib/agent/prompt";
import { tableSources } from "@/lib/agent/table-sources";
import { loadTables } from "@/lib/agent/tables";
import { formatHuman, formatLocal, zonedLocalToUtc } from "@/lib/agent/time";
import { isBusinessSlug } from "@/lib/chat/limits";
import { ENGLISH_ONLY_REPLY, isClearlyNotEnglish } from "@/lib/chat/language";
import { toolDefinitions } from "@/lib/agent/tools";
import type { Source } from "@/lib/rag/retrieve";
import { checkAnswer } from "@/lib/guard/answer-check";
import { canary } from "@/lib/guard/canary";

// One customer message, end to end (design §7, §7.1): conversation, memory,
// the agent loop, persistence and retries. The browser sends only
// { sessionId, clientMessageId, message }; history is always loaded here, so
// a client can't forge assistant turns.

// Working memory: the most recent messages that fit HISTORY_CHARS, at most
// HISTORY_LIMIT of them (design §7). Older turns are not sent, to bound cost;
// the customer's details survive via facts, and what's done or agreed via
// the "Already done" section. By size, not count: seen live, a voice call
// spelling a phone number made ~35 short fragments ("Five.", "14995"), and
// a count of 20 pushed the request the customer had just agreed out.
export const HISTORY_LIMIT = 60;
export const HISTORY_CHARS = 8_000;

// The newest messages (given newest first) that fit the budget, oldest first.
// The newest one always goes, however long.
export function fitHistory<T extends { content: string }>(newestFirst: T[], maxChars = HISTORY_CHARS): T[] {
  const kept: T[] = [];
  let used = 0;
  for (const m of newestFirst) {
    used += m.content.length;
    if (kept.length > 0 && used > maxChars) break;
    kept.push(m);
  }
  return kept.reverse();
}

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
  | { type: "error"; message: string; retryable: boolean }
  // The answer check rejected the streamed answer: show this text instead.
  | { type: "replace"; text: string };

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
  // The business's own rules for its assistant (added to the prompt).
  guidelines: string;
}

// Each chat page serves one business, picked by the slug in its URL
// (/b/[slug], decision D-14). Cached briefly per slug: every message needs it,
// and a business's profile rarely changes. Saving a profile drops its entry
// (forgetBusiness), so the next message uses the new profile; another
// server process would see it within the TTL.
//
// Only businesses that exist are cached, so the cache is bounded by the
// number of businesses: a stream of made-up slugs from the internet can't
// grow it, and a business created a moment ago is found at once.
const BUSINESS_TTL_MS = 60_000;
const businessCache = new Map<string, { value: Business; expires: number }>();
// Bumped by every save. A lookup that started before a save may have read
// the old row; it must not put it back in the cache after the save cleared it.
let businessVersion = 0;

export async function findBusiness(slug: string): Promise<Business | null> {
  if (!isBusinessSlug(slug)) return null;
  const hit = businessCache.get(slug);
  if (hit && hit.expires > Date.now()) return hit.value;
  const version = businessVersion;
  const { data, error } = await db()
    .from("businesses")
    .select("id, slug, name, description, timezone, assistant_guidelines")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`Loading business failed: ${error.message}`);
  if (!data) {
    businessCache.delete(slug);
    return null;
  }
  const { assistant_guidelines, ...rest } = data;
  const business = { ...rest, guidelines: assistant_guidelines };
  if (version === businessVersion) businessCache.set(slug, { value: business, expires: Date.now() + BUSINESS_TTL_MS });
  return business;
}

// After a profile is saved: under its old slug and its new one.
export function forgetBusiness(...slugs: string[]) {
  businessVersion++;
  for (const slug of slugs) businessCache.delete(slug);
}

export const UNKNOWN_BUSINESS = "This assistant doesn't exist.";

export async function requireBusiness(slug: string): Promise<Business> {
  const business = await findBusiness(slug);
  if (!business) throw new ChatHttpError(404, UNKNOWN_BUSINESS);
  return business;
}

// Race-safe get-or-create (design Q2): two tabs opening at once both end up
// with the same row.
export async function conversationFor(businessId: string, sessionId: string) {
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

// What the answer check replaced: kept on the message for staff.
interface Replaced {
  original: string;
  reason: string;
}

export async function runChatTurn(
  prepared: Extract<Awaited<ReturnType<typeof prepareChatTurn>>, { kind: "run" }>,
  input: ChatTurnInput,
  emit: (e: ChatEvent) => void,
  deps: ChatTurnDeps = defaultTurnDeps,
) {
  const { business, conversation, userMessageId } = prepared;
  const started = Date.now();
  emit({ type: "start", userMessageId });

  // English only (language.ts): a message clearly in another language gets
  // the fixed reply, saved like any answer, without calling the model.
  if (isClearlyNotEnglish(input.message)) {
    emit({ type: "delta", text: ENGLISH_ONLY_REPLY });
    let messageId: number;
    try {
      messageId = await withOneRetry(() =>
        saveReply(conversation.id, userMessageId, { text: ENGLISH_ONLY_REPLY, sources: [], actions: [], toolCalls: [], evidence: [], rounds: 0, usage: { input: 0, output: 0, cachedInput: 0 } }),
      );
    } catch (err) {
      await markFailed(userMessageId);
      log({ outcome: "save_failed", conversationId: conversation.id, ms: Date.now() - started, error: errorText(err) });
      emit({ type: "error", message: REPLY_NOT_SAVED, retryable: false });
      return;
    }
    emit({ type: "sources", sources: [] });
    emit({ type: "done", messageId });
    log({ outcome: "not_english", conversationId: conversation.id, ms: Date.now() - started });
    return;
  }

  // Everything from here on is covered: any failure marks the turn failed, so
  // a retry re-runs at once instead of waiting out the in-progress window.
  let result: TurnResult;
  let evidence: string;
  let tables: BusinessTables;
  try {
    // Independent reads, in parallel: all sit before the first model call.
    const [history, state, loaded] = await Promise.all([
      recentHistory(conversation.id, userMessageId),
      conversationState(conversation, business.timezone),
      loadTables(business.id),
    ]);
    tables = loaded;
    const promptInput = { business, tables, now: new Date(), customerFacts: (conversation.customer_facts ?? {}) as CustomerFacts, state };
    result = await runAgentTurn(
      {
        model: env().OPENAI_CHAT_MODEL,
        system: buildSystemPrompt({ ...promptInput, channel: "text", canary: canary() }),
        history,
        userText: input.message,
        tools: toolDefinitions(),
        toolCtx: { businessId: business.id, conversationId: conversation.id, channel: "text", timeZone: business.timezone, now: () => new Date() },
        emit,
      },
      { complete: deps.complete, executeTool },
    );
    // What the assistant was allowed to know this turn, for the answer check:
    // the facts in its prompt (not the rules, whose numbers aren't facts),
    // the conversation, and what its tools returned.
    evidence = [promptFacts(promptInput), ...history.map((m) => m.content), input.message, ...result.evidence].join("\n");
  } catch (err) {
    await markFailed(userMessageId);
    log({ outcome: err instanceof TurnDeadlineError ? "deadline" : "error", conversationId: conversation.id, ms: Date.now() - started, error: errorText(err) });
    emit({ type: "error", message: AI_UNAVAILABLE, retryable: true });
    return;
  }

  // The answer check (plain code): a leaked prompt or an invented figure is
  // replaced by a safe reply, on screen and in what's saved. The original
  // and the reason stay on the message for staff (the issues list).
  const check = checkAnswer({ answer: result.text, businessName: business.name, canary: canary(), evidence });
  let replaced: Replaced | undefined;
  if (!check.ok) {
    replaced = { original: result.text, reason: check.reason };
    result = { ...result, text: check.safeReply, sources: [] };
    emit({ type: "replace", text: check.safeReply });
  } else {
    // An answer from the tables cites the rows it quotes, before the documents.
    const today = formatLocal(new Date(), business.timezone).slice(0, 10);
    result = { ...result, sources: [...tableSources(result.text, tables, today), ...result.sources] };
  }

  // The customer has now read the whole answer. Saving it gets one retry; if
  // it still fails, say so plainly instead of inviting a retry that would run
  // the model again and show a different answer.
  let messageId: number;
  try {
    messageId = await withOneRetry(() => saveReply(conversation.id, userMessageId, result, replaced));
  } catch (err) {
    await markFailed(userMessageId);
    log({ outcome: "save_failed", conversationId: conversation.id, ms: Date.now() - started, error: errorText(err) });
    emit({ type: "error", message: REPLY_NOT_SAVED, retryable: false });
    return;
  }

  emit({ type: "sources", sources: result.sources });
  emit({ type: "done", messageId });
  log({
    outcome: "ok",
    conversationId: conversation.id,
    ms: Date.now() - started,
    rounds: result.rounds,
    tools: result.toolCalls,
    usage: result.usage,
    // Not the reason: it can quote what the model wrote.
    ...(replaced ? { replaced: true } : {}),
  });
}

// History before this message (the current one is passed separately), or
// the latest messages when there is no current one (a voice session start).
export async function recentHistory(conversationId: string, beforeMessageId?: number): Promise<HistoryMessage[]> {
  let query = db().from("messages").select("role, content").eq("conversation_id", conversationId).not("content", "is", null);
  if (beforeMessageId !== undefined) query = query.lt("id", beforeMessageId);
  const { data, error } = await query.order("id", { ascending: false }).limit(beforeMessageId === undefined ? HISTORY_LIMIT : HISTORY_LIMIT - 1);
  if (error) throw new Error(`Loading history failed: ${error.message}`);
  return fitHistory((data ?? []).map((r) => ({ role: r.role as HistoryMessage["role"], content: r.content! })));
}

// Live from the database, so a request staff confirmed or cancelled shows its
// current status.
// A consultation request read back (confirm_first) or confirmed but waiting
// for contact details (lead_required), with no request at that time yet.
function agreedRequest(
  call: { arguments: Json; result: Json } | null,
  requests: { preferred_at: string; status: string }[],
  timeZone: string,
): ConversationState["agreed"] {
  const result = (call?.result ?? {}) as { error?: string; details?: { service?: string } };
  const args = (call?.arguments ?? {}) as { service?: unknown; preferred_datetime?: unknown };
  if (!call || (result.error !== "confirm_first" && result.error !== "lead_required")) return null;
  if (typeof args.preferred_datetime !== "string" || typeof args.service !== "string") return null;
  const at = zonedLocalToUtc(args.preferred_datetime, timeZone);
  if (!at.ok) return null;
  if (requests.some((r) => r.status !== "cancelled" && new Date(r.preferred_at).getTime() === at.at.getTime())) return null;
  return {
    service: result.details?.service ?? args.service,
    preferredTime: formatHuman(at.at, timeZone),
    preferredLocal: formatLocal(at.at, timeZone),
    waitingFor: result.error === "lead_required" ? "contact" : "yes",
  };
}

export async function conversationState(conversation: { id: string; lead_id: string | null }, timeZone: string): Promise<ConversationState> {
  const [{ data, error }, followUp, proposal] = await Promise.all([
    db().from("consultation_requests").select("service, preferred_at, status").eq("conversation_id", conversation.id).order("created_at"),
    db().from("follow_ups").select("reason").eq("conversation_id", conversation.id).eq("status", "open").maybeSingle(),
    // The latest attempt to request a consultation: one agreed but not saved
    // yet must survive however long the conversation gets.
    db().from("tool_calls").select("arguments, result").eq("conversation_id", conversation.id).eq("name", "create_consultation_request").order("id", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (error || followUp.error || proposal.error) throw new Error(`Loading requests failed: ${(error ?? followUp.error ?? proposal.error)!.message}`);
  return {
    contactSaved: conversation.lead_id !== null,
    followUp: followUp.data?.reason ?? null,
    agreed: agreedRequest(proposal.data, data ?? [], timeZone),
    requests: (data ?? []).map((r) => ({
      service: r.service,
      preferredTime: formatHuman(new Date(r.preferred_at), timeZone),
      preferredLocal: formatLocal(new Date(r.preferred_at), timeZone),
      status: r.status,
    })),
  };
}

async function saveReply(conversationId: string, userMessageId: number, result: TurnResult, replaced?: Replaced): Promise<number> {
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
      replaced_original: replaced?.original ?? null,
      replaced_reason: replaced?.reason ?? null,
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
