import "server-only";
import { db } from "@/lib/db/supabase";
import type { Channel } from "@/lib/db/enums";
import type { Source } from "@/lib/rag/retrieve";
import { ChatHttpError } from "@/lib/chat/turn";
import { interleave, type MessageFlag, type TranscriptItem, type TranscriptMessage, type TranscriptToolCall } from "./transcript";

// Conversation review (US-9.1 – 9.3). Every query is scoped to one business:
// a conversation id from another business is a 404, like one that doesn't
// exist.

const LIST_LIMIT = 200;
// The newest messages of a long conversation, like the chat's own history.
const TRANSCRIPT_LIMIT = 500;

export interface ConversationRow {
  id: string;
  startedAt: string;
  lastActivity: string;
  lead: { id: string; name: string } | null;
  messages: number;
  channels: Channel[];
  // The last message with text, for the list.
  preview: string | null;
}

// admin_conversations in SQL; the generated types can't tell its nullable
// columns (no lead, no text yet) from the others.
interface ConversationRecord {
  id: string;
  started_at: string;
  last_message_at: string;
  lead_id: string | null;
  lead_name: string | null;
  message_count: number;
  has_text: boolean;
  has_voice: boolean;
  preview: string | null;
}

// Newest activity first; conversations nobody wrote in are left out.
export async function listConversations(businessId: string, limit = LIST_LIMIT): Promise<ConversationRow[]> {
  const { data, error } = await db().rpc("admin_conversations", { p_business_id: businessId, p_limit: limit });
  if (error) throw new Error(`Loading conversations failed: ${error.message}`);
  return ((data ?? []) as ConversationRecord[]).map((c) => ({
    id: c.id,
    startedAt: c.started_at,
    lastActivity: c.last_message_at,
    lead: c.lead_id && c.lead_name ? { id: c.lead_id, name: c.lead_name } : null,
    messages: Number(c.message_count),
    channels: [...(c.has_text ? (["text"] as const) : []), ...(c.has_voice ? (["voice"] as const) : [])],
    preview: c.preview,
  }));
}

export interface Transcript {
  conversation: { id: string; startedAt: string; lastActivity: string; lead: { id: string; name: string } | null };
  items: TranscriptItem[];
  // Older messages exist than the ones shown.
  earlierOmitted: boolean;
}

export async function conversationTranscript(businessId: string, conversationId: string): Promise<Transcript> {
  const [conversation, messages, calls, flags] = await Promise.all([
    db().from("conversations").select("id, created_at, last_message_at, leads(id, name)").eq("business_id", businessId).eq("id", conversationId).maybeSingle(),
    // One more than shown, to know whether older ones exist.
    db()
      .from("messages")
      .select("id, role, channel, content, sources, created_at, reply_failed_at")
      .eq("conversation_id", conversationId)
      .order("id", { ascending: false })
      .limit(TRANSCRIPT_LIMIT + 1),
    db()
      .from("tool_calls")
      .select("id, name, channel, arguments, result, ok, duration_ms, created_at, message_id")
      .eq("conversation_id", conversationId)
      .order("id", { ascending: false })
      .limit(TRANSCRIPT_LIMIT * 2),
    db().from("flags").select("message_id, layer, category, reason, original").eq("conversation_id", conversationId).order("id"),
  ]);
  if (conversation.error) throw new Error(`Loading conversation failed: ${conversation.error.message}`);
  if (messages.error) throw new Error(`Loading messages failed: ${messages.error.message}`);
  if (calls.error) throw new Error(`Loading tool calls failed: ${calls.error.message}`);
  if (flags.error) throw new Error(`Loading flags failed: ${flags.error.message}`);
  // Checked after the reads (which ran in parallel): nothing read for a
  // conversation of another business is returned.
  if (!conversation.data) throw new ChatHttpError(404, "That conversation doesn't exist.");

  const earlierOmitted = (messages.data ?? []).length > TRANSCRIPT_LIMIT;
  const flagsByMessage = new Map<number, MessageFlag[]>();
  for (const f of flags.data ?? []) {
    if (f.message_id === null) continue;
    flagsByMessage.set(f.message_id, [...(flagsByMessage.get(f.message_id) ?? []), { layer: f.layer as MessageFlag["layer"], category: f.category, reason: f.reason, original: f.original }]);
  }
  const shown: TranscriptMessage[] = (messages.data ?? []).slice(0, TRANSCRIPT_LIMIT).map((m) => ({
    kind: "message",
    id: m.id,
    role: m.role as "user" | "assistant",
    channel: m.channel as Channel,
    content: m.content,
    sources: Array.isArray(m.sources) ? (m.sources as unknown as Source[]) : [],
    createdAt: m.created_at,
    replyFailed: m.reply_failed_at !== null,
    flags: flagsByMessage.get(m.id) ?? [],
  }));
  // With older messages left out, their tool calls are left out too.
  const oldest = earlierOmitted ? new Date(shown[shown.length - 1].createdAt).getTime() : -Infinity;
  const toolCalls: TranscriptToolCall[] = (calls.data ?? [])
    .filter((c) => new Date(c.created_at).getTime() >= oldest)
    .map((c) => ({
      kind: "tool",
      id: c.id,
      name: c.name,
      channel: c.channel as Channel,
      arguments: c.arguments,
      result: c.result,
      ok: c.ok,
      durationMs: c.duration_ms,
      createdAt: c.created_at,
      messageId: c.message_id,
    }));

  const c = conversation.data;
  return {
    conversation: { id: c.id, startedAt: c.created_at, lastActivity: c.last_message_at, lead: c.leads ? { id: c.leads.id, name: c.leads.name } : null },
    items: interleave(shown, toolCalls),
    earlierOmitted,
  };
}

export interface KnowledgeGap {
  id: number;
  // What the assistant searched for: the topic the documents don't cover.
  query: string;
  conversationId: string;
  askedAt: string;
}

// The newest searches that found nothing (US-9.3), each linked to its
// conversation. Successful searches only: a search that failed (an outage)
// says nothing about the documents.
export async function knowledgeGaps(businessId: string, limit = 8): Promise<KnowledgeGap[]> {
  const { data, error } = await db()
    .from("tool_calls")
    .select("id, arguments, conversation_id, created_at, conversations!inner(business_id)")
    .eq("conversations.business_id", businessId)
    .eq("name", "search_knowledge")
    .eq("result->>found", "false")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Loading unanswered questions failed: ${error.message}`);
  return (data ?? []).map((g) => {
    const args = g.arguments as { query?: unknown };
    return { id: g.id, query: typeof args.query === "string" ? args.query : "", conversationId: g.conversation_id, askedAt: g.created_at };
  });
}
