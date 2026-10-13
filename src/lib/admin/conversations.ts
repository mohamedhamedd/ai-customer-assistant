import "server-only";
import { db } from "@/lib/db/supabase";
import type { Channel } from "@/lib/db/enums";
import type { Source } from "@/lib/rag/retrieve";
import { ChatHttpError } from "@/lib/chat/turn";
import { interleave, type TranscriptItem, type TranscriptMessage, type TranscriptToolCall } from "./transcript";

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
  // An answer the check replaced, or a tool call that failed (the issues list).
  hasIssue: boolean;
}

// admin_conversation_list in SQL; the generated types can't tell its nullable
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
  has_issue: boolean;
}

// Newest activity first; conversations nobody wrote in are left out.
// issuesOnly: only those with an issue (see hasIssue).
export async function listConversations(businessId: string, { issuesOnly = false, limit = LIST_LIMIT } = {}): Promise<ConversationRow[]> {
  const { data, error } = await db().rpc("admin_conversation_list", { p_business_id: businessId, p_limit: limit, p_issues_only: issuesOnly });
  if (error) throw new Error(`Loading conversations failed: ${error.message}`);
  return ((data ?? []) as ConversationRecord[]).map((c) => ({
    id: c.id,
    startedAt: c.started_at,
    lastActivity: c.last_message_at,
    lead: c.lead_id && c.lead_name ? { id: c.lead_id, name: c.lead_name } : null,
    messages: Number(c.message_count),
    channels: [...(c.has_text ? (["text"] as const) : []), ...(c.has_voice ? (["voice"] as const) : [])],
    preview: c.preview,
    hasIssue: c.has_issue,
  }));
}

export interface Transcript {
  conversation: { id: string; startedAt: string; lastActivity: string; lead: { id: string; name: string } | null };
  items: TranscriptItem[];
  // Older messages exist than the ones shown.
  earlierOmitted: boolean;
}

export async function conversationTranscript(businessId: string, conversationId: string): Promise<Transcript> {
  const [conversation, messages, calls] = await Promise.all([
    db().from("conversations").select("id, created_at, last_message_at, leads(id, name)").eq("business_id", businessId).eq("id", conversationId).maybeSingle(),
    // One more than shown, to know whether older ones exist.
    db()
      .from("messages")
      .select("id, role, channel, content, sources, created_at, reply_failed_at, replaced_original, replaced_reason")
      .eq("conversation_id", conversationId)
      .order("id", { ascending: false })
      .limit(TRANSCRIPT_LIMIT + 1),
    db()
      .from("tool_calls")
      .select("id, name, channel, arguments, result, ok, duration_ms, created_at, message_id")
      .eq("conversation_id", conversationId)
      .order("id", { ascending: false })
      .limit(TRANSCRIPT_LIMIT * 2),
  ]);
  if (conversation.error) throw new Error(`Loading conversation failed: ${conversation.error.message}`);
  if (messages.error) throw new Error(`Loading messages failed: ${messages.error.message}`);
  if (calls.error) throw new Error(`Loading tool calls failed: ${calls.error.message}`);
  // Checked after the reads (which ran in parallel): nothing read for a
  // conversation of another business is returned.
  if (!conversation.data) throw new ChatHttpError(404, "That conversation doesn't exist.");

  const earlierOmitted = (messages.data ?? []).length > TRANSCRIPT_LIMIT;
  const shown: TranscriptMessage[] = (messages.data ?? []).slice(0, TRANSCRIPT_LIMIT).map((m) => ({
    kind: "message",
    id: m.id,
    role: m.role as "user" | "assistant",
    channel: m.channel as Channel,
    content: m.content,
    sources: Array.isArray(m.sources) ? (m.sources as unknown as Source[]) : [],
    createdAt: m.created_at,
    replyFailed: m.reply_failed_at !== null,
    replaced: m.replaced_reason !== null && m.replaced_original !== null ? { original: m.replaced_original, reason: m.replaced_reason } : null,
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

export interface Issue {
  kind: "replaced_answer" | "tool_failed";
  // What happened, in staff words (no customer details).
  label: string;
  conversationId: string;
  at: string;
}

// Tool errors that are problems: the database was down, or a write's outcome
// is unknown. Not invalid input, confirm_first, choose_service,
// service_not_found or outside_opening_hours: those are the conversation
// working as intended.
export const FAILED_TOOL_ERRORS = ["temporarily_unavailable", "outcome_unknown"];

// The newest issues across the business, and how many since `since`: answers
// the answer check replaced, and tool calls that failed. Both rare, both on
// partial indexes.
export async function recentIssues(businessId: string, since: string, limit = 5): Promise<{ issues: Issue[]; count: number }> {
  const replacedAnswers = () =>
    db().from("messages").select("conversation_id, created_at, replaced_reason, conversations!inner(business_id)").eq("conversations.business_id", businessId).not("replaced_reason", "is", null);
  const failedTools = () =>
    db().from("tool_calls").select("name, result, conversation_id, created_at, conversations!inner(business_id)").eq("conversations.business_id", businessId).in("result->>error", FAILED_TOOL_ERRORS);
  const [replaced, failed, replacedCount, failedCount] = await Promise.all([
    replacedAnswers().order("created_at", { ascending: false }).limit(limit),
    failedTools().order("created_at", { ascending: false }).limit(limit),
    db().from("messages").select("id, conversations!inner(business_id)", { count: "exact", head: true }).eq("conversations.business_id", businessId).not("replaced_reason", "is", null).gte("created_at", since),
    db().from("tool_calls").select("id, conversations!inner(business_id)", { count: "exact", head: true }).eq("conversations.business_id", businessId).in("result->>error", FAILED_TOOL_ERRORS).gte("created_at", since),
  ]);
  for (const r of [replaced, failed, replacedCount, failedCount]) {
    if (r.error) throw new Error(`Loading issues failed: ${r.error.message}`);
  }
  const issues: Issue[] = [
    ...(replaced.data ?? []).map((m) => ({ kind: "replaced_answer" as const, label: `Answer replaced: ${m.replaced_reason}`, conversationId: m.conversation_id, at: m.created_at })),
    ...(failed.data ?? []).map((t) => ({
      kind: "tool_failed" as const,
      label: `${t.name} failed: ${String((t.result as { error?: string }).error ?? "error").replace(/_/g, " ")}`,
      conversationId: t.conversation_id,
      at: t.created_at,
    })),
  ];
  issues.sort((a, b) => b.at.localeCompare(a.at));
  return { issues: issues.slice(0, limit), count: (replacedCount.count ?? 0) + (failedCount.count ?? 0) };
}
