import "server-only";
import { db } from "@/lib/db/supabase";
import { CONSULTATION_STATUSES, type Channel, type ConsultationStatus } from "@/lib/db/enums";
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
export async function listLeads(businessId: string, search = ""): Promise<LeadRow[]> {
  const q = search.trim().slice(0, 100);
  const base = () => db().from("leads").select(LEAD_COLUMNS).eq("business_id", businessId).order("created_at", { ascending: false }).limit(LIST_LIMIT);
  const results = await Promise.all(q ? [base().ilike("name", likePattern(q)), base().ilike("email", likePattern(q))] : [base()]);
  const rows = results.flatMap((r) => {
    if (r.error) throw new Error(`Loading leads failed: ${r.error.message}`);
    return r.data ?? [];
  });
  // A lead matching on both name and email appears once.
  const byId = new Map(rows.map((row) => [row.id, row]));
  return [...byId.values()]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, LIST_LIMIT)
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

export async function statusCounts(businessId: string): Promise<Record<ConsultationStatus, number>> {
  const counts = await Promise.all(
    CONSULTATION_STATUSES.map(async (status) => {
      const { count, error } = await db()
        .from("consultation_requests")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .eq("status", status);
      if (error) throw new Error(`Counting requests failed: ${error.message}`);
      return [status, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(counts) as Record<ConsultationStatus, number>;
}

// Soonest preferred time first: what staff need to confirm next.
export async function listConsultations(businessId: string, filter: StatusFilter) {
  let query = db().from("consultation_requests").select(REQUEST_COLUMNS).eq("business_id", businessId);
  if (filter !== "all") query = query.eq("status", filter);
  const [list, counts] = await Promise.all([query.order("preferred_at").limit(LIST_LIMIT), statusCounts(businessId)]);
  if (list.error) throw new Error(`Loading requests failed: ${list.error.message}`);
  return { requests: (list.data ?? []).map(toRequestRow), counts };
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

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export async function overview(businessId: string) {
  const since = new Date(Date.now() - WEEK_MS).toISOString();
  const count = async (table: "conversations" | "leads", from: string) => {
    const { count: n, error } = await db().from(table).select("id", { count: "exact", head: true }).eq("business_id", businessId).gte("created_at", from);
    if (error) throw new Error(`Counting ${table} failed: ${error.message}`);
    return n ?? 0;
  };
  const [conversations, leads, counts, documents, recentRequests, recentLeads] = await Promise.all([
    count("conversations", since),
    count("leads", since),
    statusCounts(businessId),
    db().from("documents").select("status").eq("business_id", businessId),
    db().from("consultation_requests").select(REQUEST_COLUMNS).eq("business_id", businessId).order("created_at", { ascending: false }).limit(5),
    listLeads(businessId).then((all) => all.slice(0, 5)),
  ]);
  if (documents.error) throw new Error(`Counting documents failed: ${documents.error.message}`);
  if (recentRequests.error) throw new Error(`Loading requests failed: ${recentRequests.error.message}`);
  return {
    conversations7d: conversations,
    leads7d: leads,
    pendingRequests: counts.pending,
    documentsReady: (documents.data ?? []).filter((d) => d.status === "ready").length,
    documentsTotal: documents.data?.length ?? 0,
    recentRequests: (recentRequests.data ?? []).map(toRequestRow),
    recentLeads,
  };
}
