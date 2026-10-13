import "server-only";
import { zonedLocalToUtc } from "@/lib/agent/time";
import { db } from "@/lib/db/supabase";
import type { Database } from "@/lib/db/database.types";
import type { Channel, ConsultationStatus } from "@/lib/db/enums";
import { ChatHttpError } from "@/lib/chat/turn";
import { knowledgeGaps, recentIssues } from "./conversations";

// Leads, consultation requests and the overview (US-8.1 – 8.3). Every query
// is scoped to one business (the slug in the URL). Times are returned as UTC
// ISO strings; the page shows them in the business's timezone.

// Lists are bounded: a small business has tens to hundreds of rows. Past
// this, the next step is cursor pagination on (created_at, id).
const LIST_LIMIT = 200;

export interface LeadRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  interest: string | null;
  channel: Channel;
  capturedAt: string;
  requests: number;
}

// `%` and `_` are wildcards in ILIKE: a search for "50%" must match the text.
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const LEAD_COLUMNS = "id, name, email, phone, interest, source_channel, created_at, consultation_requests(count)";

// Newest first; `search` matches name or email, case-insensitive. Two plain
// ILIKE queries merged here rather than one PostgREST `or(...)` filter,
// whose syntax would need its own escaping of commas and quotes.
export async function listLeads(businessId: string, search = "", limit = LIST_LIMIT): Promise<LeadRow[]> {
  const q = search.trim().slice(0, 100);
  const base = () => db().from("leads").select(LEAD_COLUMNS).eq("business_id", businessId).order("created_at", { ascending: false }).limit(limit);
  const results = await Promise.all(q ? [base().ilike("name", likePattern(q)), base().ilike("email", likePattern(q))] : [base()]);
  const rows = results.flatMap((r) => {
    if (r.error) throw new Error(`Loading leads failed: ${r.error.message}`);
    return r.data ?? [];
  });
  // A lead matching on both name and email appears once.
  const byId = new Map(rows.map((row) => [row.id, row]));
  return [...byId.values()]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit)
    .map((l) => ({
      id: l.id,
      name: l.name,
      email: l.email,
      phone: l.phone,
      interest: l.interest,
      channel: l.source_channel as Channel,
      capturedAt: l.created_at,
      requests: l.consultation_requests[0]?.count ?? 0,
    }));
}

export interface RequestRow {
  id: string;
  leadId: string;
  customer: string;
  email: string | null;
  phone: string | null;
  service: string;
  preferredAt: string;
  status: ConsultationStatus;
  requestedAt: string;
  // Notes on the request, e.g. what the customer changed:
  // "[Changed by the customer: was Porcelain crown, Thursday, October 15, 2026 at 11:00 AM PDT.]"
  notes: string | null;
}

const REQUEST_COLUMNS = "id, lead_id, contact_name, contact_email, contact_phone, service, preferred_at, status, created_at, notes";

type RequestRecord = {
  id: string;
  lead_id: string;
  contact_name: string;
  contact_email: string | null;
  contact_phone: string | null;
  service: string;
  preferred_at: string;
  status: string;
  created_at: string;
  notes: string | null;
};

// The contact shown is the snapshot taken with the request (design §3.8),
// so staff call the person who asked, even if the lead was shared.
const toRequestRow = (r: RequestRecord): RequestRow => ({
  id: r.id,
  leadId: r.lead_id,
  customer: r.contact_name,
  email: r.contact_email,
  phone: r.contact_phone,
  service: r.service,
  preferredAt: r.preferred_at,
  status: r.status as ConsultationStatus,
  requestedAt: r.created_at,
  notes: r.notes,
});

// Upcoming requests first (soonest first), then past ones (latest first):
// the same order as the consultations page.
function upcomingFirst(rows: RequestRow[], now = Date.now()): RequestRow[] {
  const at = (r: RequestRow) => new Date(r.preferredAt).getTime();
  const upcoming = rows.filter((r) => at(r) >= now).sort((a, b) => at(a) - at(b));
  const past = rows.filter((r) => at(r) < now).sort((a, b) => at(b) - at(a));
  return [...upcoming, ...past];
}

export async function leadDetail(businessId: string, leadId: string) {
  const [lead, requests, conversations, followUps] = await Promise.all([
    db().from("leads").select("id, name, email, phone, interest, source_channel, created_at").eq("business_id", businessId).eq("id", leadId).maybeSingle(),
    db().from("consultation_requests").select(REQUEST_COLUMNS).eq("business_id", businessId).eq("lead_id", leadId).order("preferred_at"),
    // Where the lead came from: usually one conversation, more if the same
    // person came back in a new session.
    db().from("conversations").select("id, last_message_at").eq("business_id", businessId).eq("lead_id", leadId).order("last_message_at", { ascending: false }).limit(5),
    db().from("follow_ups").select(FOLLOW_UP_COLUMNS).eq("business_id", businessId).eq("lead_id", leadId).order("created_at", { ascending: false }).limit(10),
  ]);
  if (lead.error) throw new Error(`Loading lead failed: ${lead.error.message}`);
  if (requests.error) throw new Error(`Loading requests failed: ${requests.error.message}`);
  if (conversations.error) throw new Error(`Loading conversations failed: ${conversations.error.message}`);
  if (followUps.error) throw new Error(`Loading follow-ups failed: ${followUps.error.message}`);
  if (!lead.data) throw new ChatHttpError(404, "That lead doesn't exist.");
  const l = lead.data;
  return {
    lead: { id: l.id, name: l.name, email: l.email, phone: l.phone, interest: l.interest, channel: l.source_channel as Channel, capturedAt: l.created_at },
    requests: upcomingFirst((requests.data ?? []).map(toRequestRow)),
    conversations: (conversations.data ?? []).map((c) => ({ id: c.id, lastActivity: c.last_message_at })),
    followUps: ((followUps.data ?? []) as unknown as FollowUpRecord[]).map(toFollowUpRow),
  };
}

export type StatusFilter = ConsultationStatus | "all";

interface AdminCounts {
  pending: number;
  confirmed: number;
  cancelled: number;
  active_conversations: number;
  new_leads: number;
  documents_ready: number;
  documents_total: number;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// One query for every count the admin shows (admin_counts in SQL).
async function adminCounts(businessId: string): Promise<AdminCounts> {
  const { data, error } = await db().rpc("admin_counts", { p_business_id: businessId, p_since: new Date(Date.now() - WEEK_MS).toISOString() });
  if (error) throw new Error(`Counting failed: ${error.message}`);
  return data as unknown as AdminCounts;
}

// The tabs and the sidebar badge: one indexed pass over this business's
// requests (consultation_status_counts in SQL), not the overview's counts.
export async function statusCounts(businessId: string): Promise<Record<ConsultationStatus, number>> {
  const { data, error } = await db().rpc("consultation_status_counts", { p_business_id: businessId });
  if (error) throw new Error(`Counting requests failed: ${error.message}`);
  return data as unknown as Record<ConsultationStatus, number>;
}

export const CONSULTATION_SORTS = ["upcoming", "requested_desc", "requested_asc", "date_asc", "date_desc"] as const;
export type ConsultationSort = (typeof CONSULTATION_SORTS)[number];

export interface ConsultationQuery {
  status: StatusFilter;
  // upcoming: upcoming soonest first, then past most recent first (what staff confirm next).
  sort?: ConsultationSort;
  // Preferred date range, the business's local dates ("YYYY-MM-DD"), both included.
  from?: string;
  to?: string;
  // 1-based.
  page?: number;
}

export const CONSULTATION_PAGE_SIZE = 25;

// Midnight at the start of a local date, as an instant; the end of `to` is the next midnight.
function localDayStart(date: string, timeZone: string, nextDay = false): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + (nextDay ? 1 : 0)));
  const local = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}T00:00`;
  const at = zonedLocalToUtc(local, timeZone);
  return at.ok ? at.at.toISOString() : null;
}

// One page of requests (admin_consultation_list), and the status counts for the tabs.
export async function listConsultations(businessId: string, timeZone: string, query: ConsultationQuery) {
  const page = Math.max(1, query.page ?? 1);
  const [list, counts] = await Promise.all([
    // The generated types can't say these parameters take null ("no filter"), which the SQL handles.
    db().rpc("admin_consultation_list", {
      p_business_id: businessId,
      p_status: query.status === "all" ? null : query.status,
      p_from: query.from ? localDayStart(query.from, timeZone) : null,
      p_to: query.to ? localDayStart(query.to, timeZone, true) : null,
      p_sort: query.sort ?? "upcoming",
      p_limit: CONSULTATION_PAGE_SIZE,
      p_offset: (page - 1) * CONSULTATION_PAGE_SIZE,
    } as unknown as Database["public"]["Functions"]["admin_consultation_list"]["Args"]),
    statusCounts(businessId),
  ]);
  if (list.error) throw new Error(`Loading requests failed: ${list.error.message}`);
  const rows = (list.data ?? []) as unknown as (RequestRecord & { total_count: number })[];
  return {
    requests: rows.map(toRequestRow),
    total: rows.length ? Number(rows[0].total_count) : 0,
    page,
    pageSize: CONSULTATION_PAGE_SIZE,
    counts,
  };
}

export async function setConsultationStatus(businessId: string, requestId: string, status: ConsultationStatus): Promise<RequestRow> {
  const { data, error } = await db()
    .from("consultation_requests")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("business_id", businessId)
    .eq("id", requestId)
    .select(REQUEST_COLUMNS)
    .maybeSingle();
  if (error) {
    // Re-opening a cancelled request whose time slot was requested again
    // meanwhile: the dedupe index allows one active request per slot.
    if (error.message.includes("consultation_requests_dedupe_idx")) {
      throw new ChatHttpError(409, "This customer already has an active request for that time, so this one can't be reopened.");
    }
    throw new Error(`Updating request failed: ${error.message}`);
  }
  if (!data) throw new ChatHttpError(404, "That request doesn't exist.");
  return toRequestRow(data);
}

// ---------------------------------------------------------------------------
// Follow-ups: what customers asked the team to contact them about
// ---------------------------------------------------------------------------

export type FollowUpStatus = "open" | "done";

export interface FollowUpRow {
  id: string;
  leadId: string;
  customer: string;
  email: string | null;
  phone: string | null;
  // In the customer's terms, as read back to them.
  reason: string;
  status: FollowUpStatus;
  conversationId: string | null;
  requestedAt: string;
  doneAt: string | null;
}

const FOLLOW_UP_COLUMNS = "id, lead_id, conversation_id, reason, status, created_at, done_at, leads!inner(name, email, phone)";

type FollowUpRecord = {
  id: string;
  lead_id: string;
  conversation_id: string | null;
  reason: string;
  status: string;
  created_at: string;
  done_at: string | null;
  leads: { name: string; email: string | null; phone: string | null };
};

const toFollowUpRow = (f: FollowUpRecord): FollowUpRow => ({
  id: f.id,
  leadId: f.lead_id,
  customer: f.leads.name,
  email: f.leads.email,
  phone: f.leads.phone,
  reason: f.reason,
  status: f.status as FollowUpStatus,
  conversationId: f.conversation_id,
  requestedAt: f.created_at,
  doneAt: f.done_at,
});

// The open follow-ups, oldest first (waiting longest), and how many there are.
export async function openFollowUps(businessId: string, limit = 10): Promise<{ followUps: FollowUpRow[]; count: number }> {
  const { data, error, count } = await db()
    .from("follow_ups")
    .select(FOLLOW_UP_COLUMNS, { count: "exact" })
    .eq("business_id", businessId)
    .eq("status", "open")
    .order("created_at")
    .limit(limit);
  if (error) throw new Error(`Loading follow-ups failed: ${error.message}`);
  return { followUps: ((data ?? []) as unknown as FollowUpRecord[]).map(toFollowUpRow), count: count ?? 0 };
}

// Done (or open again, to undo). Open again only while the conversation has
// no other open one (one open per conversation).
export async function setFollowUpStatus(businessId: string, id: string, status: FollowUpStatus): Promise<FollowUpRow> {
  const { data, error } = await db()
    .from("follow_ups")
    .update({ status, done_at: status === "done" ? new Date().toISOString() : null })
    .eq("business_id", businessId)
    .eq("id", id)
    .select(FOLLOW_UP_COLUMNS)
    .maybeSingle();
  if (error?.message.includes("follow_ups_open_per_conversation_idx")) {
    throw new ChatHttpError(409, "This conversation already has an open follow-up, so this one can't be reopened.");
  }
  if (error) throw new Error(`Updating follow-up failed: ${error.message}`);
  if (!data) throw new ChatHttpError(404, "That follow-up doesn't exist.");
  return toFollowUpRow(data as unknown as FollowUpRecord);
}

export async function overview(businessId: string) {
  const since = new Date(Date.now() - WEEK_MS).toISOString();
  const [counts, recentRequests, recentLeads, gaps, issues, followUps] = await Promise.all([
    adminCounts(businessId),
    db().from("consultation_requests").select(REQUEST_COLUMNS).eq("business_id", businessId).order("created_at", { ascending: false }).limit(5),
    listLeads(businessId, "", 5),
    knowledgeGaps(businessId, 5),
    // Answers the check replaced and tool calls that failed: the latest, and how many this week.
    recentIssues(businessId, since, 5),
    openFollowUps(businessId, 10),
  ]);
  if (recentRequests.error) throw new Error(`Loading requests failed: ${recentRequests.error.message}`);
  return {
    // Conversations with a message in the last 7 days (returning visitors count).
    conversations7d: counts.active_conversations,
    leads7d: counts.new_leads,
    pendingRequests: counts.pending,
    documentsReady: counts.documents_ready,
    documentsTotal: counts.documents_total,
    recentRequests: (recentRequests.data ?? []).map(toRequestRow),
    recentLeads,
    // Questions the documents don't answer (US-9.3).
    knowledgeGaps: gaps,
    issues7d: issues.count,
    recentIssues: issues.issues,
    // What customers asked the team to contact them about, still open.
    followUps: followUps.followUps,
    openFollowUps: followUps.count,
  };
}
