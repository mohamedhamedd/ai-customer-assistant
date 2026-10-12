import "server-only";
import { db } from "@/lib/db/supabase";
import type { Channel, ConsultationStatus } from "@/lib/db/enums";
import { ChatHttpError } from "@/lib/chat/turn";

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
}

const REQUEST_COLUMNS = "id, lead_id, contact_name, contact_email, contact_phone, service, preferred_at, status, created_at";

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
});

export async function leadDetail(businessId: string, leadId: string) {
  const [lead, requests] = await Promise.all([
    db().from("leads").select("id, name, email, phone, interest, source_channel, created_at").eq("business_id", businessId).eq("id", leadId).maybeSingle(),
    db().from("consultation_requests").select(REQUEST_COLUMNS).eq("business_id", businessId).eq("lead_id", leadId).order("preferred_at"),
  ]);
  if (lead.error) throw new Error(`Loading lead failed: ${lead.error.message}`);
  if (requests.error) throw new Error(`Loading requests failed: ${requests.error.message}`);
  if (!lead.data) throw new ChatHttpError(404, "That lead doesn't exist.");
  const l = lead.data;
  return {
    lead: { id: l.id, name: l.name, email: l.email, phone: l.phone, interest: l.interest, channel: l.source_channel as Channel, capturedAt: l.created_at },
    requests: (requests.data ?? []).map(toRequestRow),
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

export async function statusCounts(businessId: string): Promise<Record<ConsultationStatus, number>> {
  const { pending, confirmed, cancelled } = await adminCounts(businessId);
  return { pending, confirmed, cancelled };
}

// Upcoming requests first (soonest first: what staff confirm next), then
// past ones (most recent first). Each part is capped, so a long history can
// never push next week's requests off the list.
export async function listConsultations(businessId: string, filter: StatusFilter) {
  const now = new Date().toISOString();
  const part = (upcoming: boolean) => {
    let query = db().from("consultation_requests").select(REQUEST_COLUMNS).eq("business_id", businessId);
    if (filter !== "all") query = query.eq("status", filter);
    query = upcoming ? query.gte("preferred_at", now) : query.lt("preferred_at", now);
    return query.order("preferred_at", { ascending: upcoming }).limit(LIST_LIMIT);
  };
  const [upcoming, past, counts] = await Promise.all([part(true), part(false), statusCounts(businessId)]);
  for (const r of [upcoming, past]) if (r.error) throw new Error(`Loading requests failed: ${r.error.message}`);
  return { requests: [...(upcoming.data ?? []), ...(past.data ?? [])].map(toRequestRow), counts };
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

export async function overview(businessId: string) {
  const [counts, recentRequests, recentLeads] = await Promise.all([
    adminCounts(businessId),
    db().from("consultation_requests").select(REQUEST_COLUMNS).eq("business_id", businessId).order("created_at", { ascending: false }).limit(5),
    listLeads(businessId, "", 5),
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
  };
}
