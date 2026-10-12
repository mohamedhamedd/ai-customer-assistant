import "server-only";
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
//   1. opens the call (it holds the API key; the browser never gets one),
//   2. runs the tools the model calls (same tools, same database rules as text),
//   3. stores the transcripts in the same conversation as the text chat.

export interface VoiceTarget {
  businessSlug: string;
  sessionId: string;
}

async function voiceConversation({ businessSlug, sessionId }: VoiceTarget) {
  const business = await requireBusiness(businessSlug);
  const conversation = await conversationFor(business.id, sessionId);
  return { business, conversation };
}

export const VOICE_UNAVAILABLE = "Voice isn't available right now. You can keep typing.";

// The browser sends its WebRTC offer (SDP); we create the call with the
// session config and return OpenAI's answer. Unlike an ephemeral token, no
// credential reaches the browser at all.
export async function startVoiceCall(target: VoiceTarget & { sdp: string }): Promise<string> {
  const { business, conversation } = await voiceConversation(target);
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
  log({ outcome: "call_started", conversationId: conversation.id, historyMessages: history.length });
  return answer.text();
}

// A tool call the model made in the voice session, relayed by the browser.
// It runs with the server's own context (business, conversation): the
// browser only names the tool and passes the model's arguments, exactly
// what a customer could cause by typing. Tools validate everything.
export async function runVoiceTool(target: VoiceTarget & { name: string; arguments: string }) {
  const { business, conversation } = await voiceConversation(target);
  const outcome = await executeTool(target.name, target.arguments, {
    businessId: business.id,
    conversationId: conversation.id,
    channel: "voice",
    timeZone: business.timezone,
    now: () => new Date(),
  });
  // `output` goes back to the model; sources and the card are for the UI
  // (the stored copy is derived again on the server, see recordVoiceItem).
  return { output: outcome.output, sources: outcome.sources, action: toAction(outcome) };
}

// A voice message in two steps (design §3.5): reported when the Realtime
// item is created (so its id is in conversation order) and again when its
// transcript is ready. Both are idempotent on (conversation, item id).
export async function recordVoiceItem(target: VoiceTarget & { itemId: string; role: "user" | "assistant"; transcript?: string }) {
  const { conversation } = await voiceConversation(target);
  // A cough or silence transcribes to nothing: stored as null, never "".
  const content = target.transcript?.trim() || null;

  const { data: existing, error: findError } = await db()
    .from("messages")
    .select("id, content")
    .eq("conversation_id", conversation.id)
    .eq("client_message_id", target.itemId)
    .maybeSingle();
  if (findError) throw new Error(`Loading voice item failed: ${findError.message}`);

  if (!existing) {
    const extras = target.role === "assistant" ? await toolResultsSinceLastAnswer(conversation.id) : { sources: [], actions: [] };
    const { error } = await db()
      .from("messages")
      .upsert(
        {
          conversation_id: conversation.id,
          client_message_id: target.itemId,
          role: target.role,
          channel: "voice",
          content,
          sources: extras.sources as unknown as NonNullable<Json>,
          actions: extras.actions as unknown as NonNullable<Json>,
        },
        { onConflict: "conversation_id,client_message_id", ignoreDuplicates: true },
      );
    if (error) throw new Error(`Saving voice item failed: ${error.message}`);
    // A concurrent report inserted it first: fall through to fill the text.
    if (!content) return;
  }
  if (content && existing?.content !== content) {
    const { error } = await db()
      .from("messages")
      .update({ content })
      .eq("conversation_id", conversation.id)
      .eq("client_message_id", target.itemId);
    if (error) throw new Error(`Saving voice transcript failed: ${error.message}`);
  }
}

// Citations and cards for a voice answer come from the tool calls this
// server ran since the previous answer, not from the browser, so they can't
// be forged (and match what text chat stores). "Since the previous answer"
// rather than "since the question": the question's row may be reported
// after the tools ran, but the previous answer is always stored before them.
async function toolResultsSinceLastAnswer(conversationId: string): Promise<{ sources: Source[]; actions: Action[] }> {
  const { data: previous, error: prevError } = await db()
    .from("messages")
    .select("created_at")
    .eq("conversation_id", conversationId)
    .eq("role", "assistant")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (prevError) throw new Error(`Loading previous answer failed: ${prevError.message}`);

  let query = db().from("tool_calls").select("name, result, sources").eq("conversation_id", conversationId).eq("channel", "voice");
  if (previous) query = query.gt("created_at", previous.created_at);
  const { data, error } = await query.order("id");
  if (error) throw new Error(`Loading tool calls failed: ${error.message}`);

  const sources: Source[] = [];
  const actions: Action[] = [];
  for (const call of data ?? []) {
    sources.push(...((call.sources ?? []) as unknown as Source[]));
    const action = toAction({ name: call.name, output: call.result as unknown as ToolOutput });
    if (action && !repeatsAction(actions, action)) actions.push(action);
  }
  return { sources, actions };
}

function log(fields: Record<string, unknown>) {
  console.log(JSON.stringify({ event: "voice", ...fields }));
}
