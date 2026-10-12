import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db/supabase";
import type { Json } from "@/lib/db/database.types";
import { env } from "@/lib/env";
import { openai } from "@/lib/openai";
import { executeTool } from "@/lib/agent/execute";
import { repeatsAction, toAction, type Action } from "@/lib/agent/loop";
import type { CustomerFacts } from "@/lib/agent/prompt";
import { toolDefinitions, type ToolOutput } from "@/lib/agent/tools";
import { ChatHttpError, conversationFor, conversationState, recentHistory, requireBusiness } from "@/lib/chat/turn";
import type { Source } from "@/lib/rag/retrieve";
import { realtimeSession } from "./session";

// Voice over the OpenAI Realtime API (design D-07). The audio goes straight
// between the browser and OpenAI over WebRTC; this server:
//   1. opens the call (it holds the API key; the browser never gets one) and
//      issues a secret that every later request for this call must carry,
//   2. runs the tools the model calls (same tools, same database rules as text),
//   3. stores the transcripts in the same conversation as the text chat.

export const VOICE_UNAVAILABLE = "Voice isn't available right now. You can keep typing.";
export const CALL_EXPIRED = "This voice call has ended. Start voice again to keep talking.";

// Longer than the Realtime API's maximum session (60 minutes).
const CALL_TTL_MS = 70 * 60_000;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

// The browser sends its WebRTC offer (SDP); we create the call with the
// session config and return OpenAI's answer plus the call's secret. Unlike
// an ephemeral OpenAI token, the secret only unlocks this app's voice
// endpoints for this one conversation, and only until it expires.
export async function startVoiceCall(target: { businessSlug: string; sessionId: string; sdp: string }) {
  const business = await requireBusiness(target.businessSlug);
  const conversation = await conversationFor(business.id, target.sessionId);
  const [history, state] = await Promise.all([recentHistory(conversation.id), conversationState(conversation, business.timezone)]);
  const session = realtimeSession({
    business,
    now: new Date(),
    customerFacts: (conversation.customer_facts ?? {}) as CustomerFacts,
    state,
    history,
    tools: toolDefinitions(),
    model: env().OPENAI_REALTIME_MODEL,
    voice: env().OPENAI_REALTIME_VOICE,
    transcribeModel: env().OPENAI_TRANSCRIBE_MODEL,
  });

  let answer: Response;
  try {
    answer = await openai().realtime.calls.create({ sdp: target.sdp, session });
  } catch (err) {
    log({ outcome: "call_failed", conversationId: conversation.id, error: err instanceof Error ? err.message : String(err) });
    throw new ChatHttpError(502, VOICE_UNAVAILABLE);
  }

  const callToken = randomBytes(32).toString("base64url");
  const { error } = await db()
    .from("voice_calls")
    .insert({
      conversation_id: conversation.id,
      token_hash: hashToken(callToken),
      // "/v1/realtime/calls/rtc_…": kept to hang the call up from the server.
      openai_call_id: answer.headers.get("location")?.split("/").pop() ?? null,
      expires_at: new Date(Date.now() + CALL_TTL_MS).toISOString(),
    });
  if (error) throw new Error(`Saving voice call failed: ${error.message}`);
  log({ outcome: "call_started", conversationId: conversation.id, historyMessages: history.length });
  return { sdp: await answer.text(), callToken };
}

interface LiveCall {
  id: string;
  conversationId: string;
  businessId: string;
  timeZone: string;
}

// One query per request: the secret names the call, its conversation and
// business. Unknown or expired secret: 401, nothing runs.
async function liveCall(callToken: string): Promise<LiveCall> {
  const { data, error } = await db()
    .from("voice_calls")
    .select("id, conversation_id, expires_at, conversations!inner(business_id, businesses!inner(timezone))")
    .eq("token_hash", hashToken(callToken))
    .maybeSingle();
  if (error) throw new Error(`Loading voice call failed: ${error.message}`);
  if (!data || new Date(data.expires_at).getTime() < Date.now()) throw new ChatHttpError(401, CALL_EXPIRED);
  return {
    id: data.id,
    conversationId: data.conversation_id,
    businessId: data.conversations.business_id,
    timeZone: data.conversations.businesses.timezone,
  };
}

// A tool call the model made in the voice session, relayed by the browser.
// It runs with the server's own context for this call (business,
// conversation): the browser only names the tool and passes the model's
// arguments. Tools validate everything.
export async function runVoiceTool(input: { callToken: string; callId: string; name: string; arguments: string }) {
  const call = await liveCall(input.callToken);
  const outcome = await executeTool(input.name, input.arguments, {
    businessId: call.businessId,
    conversationId: call.conversationId,
    channel: "voice",
    timeZone: call.timeZone,
    now: () => new Date(),
    voiceCallId: call.id,
    realtimeCallId: input.callId,
  });
  // `output` goes back to the model; sources and the card are for the UI
  // (the stored copy is read again from tool_calls, see recordVoiceItem).
  return { output: outcome.output, sources: outcome.sources, action: toAction(outcome) };
}

// A voice message in two steps (design §3.5): reported when the Realtime
// item is created (so its id is in conversation order) and again when its
// transcript is ready. Both are idempotent on (conversation, item id).
export async function recordVoiceItem(input: {
  callToken: string;
  itemId: string;
  role: "user" | "assistant";
  transcript?: string;
  // Assistant only: the Realtime ids of the tool calls this answer used.
  toolCallIds?: string[];
}) {
  const call = await liveCall(input.callToken);
  // A cough or silence transcribes to nothing: stored as null, never "".
  const content = input.transcript?.trim() || null;

  const { data: existing, error: findError } = await db()
    .from("messages")
    .select("id, content")
    .eq("conversation_id", call.conversationId)
    .eq("client_message_id", input.itemId)
    .maybeSingle();
  if (findError) throw new Error(`Loading voice item failed: ${findError.message}`);

  if (existing) {
    if (content && existing.content !== content) {
      const { error } = await db().from("messages").update({ content }).eq("id", existing.id);
      if (error) throw new Error(`Saving voice transcript failed: ${error.message}`);
    }
    return;
  }

  const used = input.role === "assistant" ? await unattachedToolCalls(call.id, input.toolCallIds ?? []) : [];
  const { sources, actions } = cardsFrom(used);
  const { data: inserted, error } = await db()
    .from("messages")
    .upsert(
      {
        conversation_id: call.conversationId,
        client_message_id: input.itemId,
        role: input.role,
        channel: "voice",
        content,
        sources: sources as unknown as NonNullable<Json>,
        actions: actions as unknown as NonNullable<Json>,
      },
      { onConflict: "conversation_id,client_message_id", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw new Error(`Saving voice item failed: ${error.message}`);
  const messageId = inserted?.[0]?.id;
  // A concurrent report inserted it first; that one owns the tool calls.
  if (messageId === undefined || used.length === 0) return;
  const { error: linkError } = await db()
    .from("tool_calls")
    .update({ message_id: messageId })
    .in(
      "id",
      used.map((c) => c.id),
    );
  if (linkError) throw new Error(`Linking tool calls failed: ${linkError.message}`);
}

interface UsedToolCall {
  id: number;
  name: string;
  result: Json;
  sources: Json;
}

// The browser only names the tool calls; their results are read from this
// server's own audit log, limited to this call and to calls not already
// attached to an answer. So it can't forge a card, borrow one from another
// conversation, or show the same one twice.
async function unattachedToolCalls(voiceCallId: string, realtimeCallIds: string[]): Promise<UsedToolCall[]> {
  if (realtimeCallIds.length === 0) return [];
  const { data, error } = await db()
    .from("tool_calls")
    .select("id, name, result, sources")
    .eq("voice_call_id", voiceCallId)
    .in("realtime_call_id", realtimeCallIds)
    .is("message_id", null)
    .order("id");
  if (error) throw new Error(`Loading tool calls failed: ${error.message}`);
  return data ?? [];
}

function cardsFrom(calls: UsedToolCall[]): { sources: Source[]; actions: Action[] } {
  const sources: Source[] = [];
  const actions: Action[] = [];
  for (const call of calls) {
    sources.push(...((call.sources ?? []) as unknown as Source[]));
    const action = toAction({ name: call.name, output: call.result as unknown as ToolOutput });
    if (action && !repeatsAction(actions, action)) actions.push(action);
  }
  return { sources, actions };
}

function log(fields: Record<string, unknown>) {
  console.log(JSON.stringify({ event: "voice", ...fields }));
}
