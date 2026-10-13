// Integration tests: leads, consultation requests and the overview against
// the local database. No OpenAI calls. Needs `npm run db:start`.
// Run with `npm run test:integration`.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/supabase";
import { ChatHttpError } from "@/lib/chat/turn";
import { formatLocal } from "@/lib/agent/time";
import { leadDetail, listConsultations, listLeads, overview, setConsultationStatus } from "./crm";

// The test businesses have the default timezone.
const TZ = "America/Los_Angeles";

const businesses: string[] = [];
let mine: string;
let theirs: string;
let conversation: string;
let sara: string;
let omar: string;
let theirLead: string;
let theirRequest: string;

async function business(name: string) {
  const { data, error } = await db().from("businesses").insert({ slug: `itest-${randomUUID().slice(0, 8)}`, name }).select("id").single();
  assert.ifError(error);
  businesses.push(data!.id);
  return data!.id;
}

async function lead(businessId: string, name: string, email: string, createdAt: string) {
  const { data, error } = await db()
    .from("leads")
    .insert({ business_id: businessId, name, email, source_channel: "text", created_at: createdAt })
    .select("id")
    .single();
  assert.ifError(error);
  return data!.id;
}

async function request(businessId: string, leadId: string, preferredAt: string, status = "pending", conversationId: string | null = null) {
  const { data, error } = await db()
    .from("consultation_requests")
    .insert({ business_id: businessId, lead_id: leadId, conversation_id: conversationId, contact_name: "Snapshot Name", contact_email: "snap@example.com", service: "cleaning", preferred_at: preferredAt, status })
    .select("id")
    .single();
  assert.ifError(error);
  return data!.id;
}

// Relative to when the suite runs, so "upcoming" stays upcoming: fixed
// dates would turn into past requests (listed differently) a week later.
const BASE = Math.ceil(Date.now() / 3_600_000) * 3_600_000; // next whole hour
const day = (n: number) => new Date(BASE + n * 86_400_000).toISOString();

before(async () => {
  mine = await business("Mine");
  theirs = await business("Theirs");
  const { data: c } = await db().from("conversations").insert({ business_id: mine, session_id: randomUUID() }).select("id").single();
  conversation = c!.id;
  sara = await lead(mine, "Sara Ali", "sara@example.com", new Date(Date.now() - 60_000).toISOString());
  omar = await lead(mine, "Omar 50%_off", "omar@example.com", new Date(Date.now() - 30 * 86_400_000).toISOString());
  theirLead = await lead(theirs, "Sara Other", "sara@other.com", new Date().toISOString());
  await request(mine, sara, day(2));
  await request(mine, sara, day(1));
  await request(mine, omar, day(3), "confirmed");
  theirRequest = await request(theirs, theirLead, day(1));
});
after(async () => {
  for (const id of businesses) await db().from("businesses").delete().eq("id", id);
});

const notFound = (err: unknown) => err instanceof ChatHttpError && err.status === 404;

test("leads: this business only, newest first, with their request counts", async () => {
  const leads = await listLeads(mine);
  assert.deepEqual(
    leads.map((l) => [l.name, l.requests]),
    [
      ["Sara Ali", 2],
      ["Omar 50%_off", 1],
    ],
  );
});

test("lead search matches name or email, and % and _ are literal", async () => {
  assert.deepEqual((await listLeads(mine, "SARA")).map((l) => l.name), ["Sara Ali"], "case-insensitive, no other business");
  assert.deepEqual((await listLeads(mine, "omar@")).map((l) => l.name), ["Omar 50%_off"], "by email");
  assert.deepEqual((await listLeads(mine, "50%_")).map((l) => l.name), ["Omar 50%_off"]);
  assert.deepEqual(await listLeads(mine, "5_%"), [], "_ and % don't act as wildcards");
});

test("a lead's detail is scoped to the business", async () => {
  const detail = await leadDetail(mine, sara);
  assert.equal(detail.lead.name, "Sara Ali");
  assert.equal(detail.requests.length, 2);
  await assert.rejects(leadDetail(mine, theirLead), notFound);
});

test("consultations: filtered by status, soonest first, with counts per status", async () => {
  const pending = await listConsultations(mine, TZ, { status: "pending" });
  const ms = (iso: string) => new Date(iso).getTime();
  assert.deepEqual(pending.requests.map((r) => ms(r.preferredAt)), [ms(day(1)), ms(day(2))]);
  assert.equal(pending.requests[0].customer, "Snapshot Name", "the contact snapshot, not the lead");
  assert.deepEqual(pending.counts, { pending: 2, confirmed: 1, cancelled: 0 });
  assert.equal((await listConsultations(mine, TZ, { status: "all" })).requests.length, 3);
});

test("a status change saves, and only within the business", async () => {
  const [first] = (await listConsultations(mine, TZ, { status: "pending" })).requests;
  const updated = await setConsultationStatus(mine, first.id, "confirmed");
  assert.equal(updated.status, "confirmed");
  await assert.rejects(setConsultationStatus(mine, theirRequest, "cancelled"), notFound);
  const { data } = await db().from("consultation_requests").select("status").eq("id", theirRequest).single();
  assert.equal(data!.status, "pending", "the other business's request is untouched");
});

test("reopening a cancelled request whose slot is taken again is a 409", async () => {
  const old = await request(mine, sara, day(9), "cancelled", conversation);
  await request(mine, sara, day(9), "pending", conversation);
  await assert.rejects(setConsultationStatus(mine, old, "pending"), (err: unknown) => err instanceof ChatHttpError && err.status === 409);
});

test("past requests come after upcoming ones, most recent first", async () => {
  const past = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
  await request(mine, omar, past(2), "confirmed");
  await request(mine, omar, past(20), "confirmed");
  const confirmed = (await listConsultations(mine, TZ, { status: "confirmed" })).requests.map((r) => new Date(r.preferredAt).getTime());
  const now = Date.now();
  const upcoming = confirmed.filter((t) => t >= now);
  const earlier = confirmed.filter((t) => t < now);
  assert.ok(upcoming.length > 0 && earlier.length === 2);
  assert.deepEqual(confirmed, [...upcoming, ...earlier], "upcoming first");
  assert.ok(earlier[0] > earlier[1], "then the most recent past one");
});

test("overview counts the last 7 days and pending requests", async () => {
  // A returning visitor: the conversation is old, the message is new.
  const { data: old } = await db()
    .from("conversations")
    .insert({ business_id: mine, session_id: randomUUID(), created_at: new Date(Date.now() - 40 * 86_400_000).toISOString() })
    .select("id")
    .single();
  await db().from("messages").insert({ conversation_id: old!.id, role: "user", content: "Back again" });
  // And a second new one nobody wrote in: counting by creation would say 2.
  await db().from("conversations").insert({ business_id: mine, session_id: randomUUID() });
  const o = await overview(mine);
  assert.equal(o.leads7d, 1, "Omar was captured 30 days ago");
  assert.equal(o.conversations7d, 1, "only the conversation with a message this week counts, not the new empty ones");
  assert.equal(o.pendingRequests, (await listConsultations(mine, TZ, { status: "pending" })).counts.pending);
  assert.equal(o.recentLeads[0].name, "Sara Ali");
});

test("consultations: sorted by when they were requested or by date, filtered by a date range, in pages", async () => {
  const many = await business("Many requests");
  const someone = await lead(many, "Many", `many-${randomUUID().slice(0, 6)}@example.com`, new Date().toISOString());
  const days = Array.from({ length: 30 }, (_, i) => day(i + 1));
  // Requested in order; the preferred dates the other way round.
  for (const at of [...days].reverse()) await request(many, someone, at);
  const local = (iso: string) => formatLocal(new Date(iso), TZ).slice(0, 10);

  const first = await listConsultations(many, TZ, { status: "all" });
  assert.deepEqual([first.requests.length, first.total, first.page, first.pageSize], [25, 30, 1, 25]);
  assert.equal(new Date(first.requests[0].preferredAt).getTime(), new Date(days[0]).getTime(), "upcoming: soonest first");
  assert.equal((await listConsultations(many, TZ, { status: "all", page: 2 })).requests.length, 5);

  const newest = await listConsultations(many, TZ, { status: "all", sort: "requested_desc" });
  assert.equal(new Date(newest.requests[0].preferredAt).getTime(), new Date(days[0]).getTime(), "the last one requested was for the soonest day");
  const latest = await listConsultations(many, TZ, { status: "all", sort: "date_desc" });
  assert.equal(new Date(latest.requests[0].preferredAt).getTime(), new Date(days[29]).getTime());

  // From the 3rd to the 5th day, both included, in the business's own dates.
  const range = await listConsultations(many, TZ, { status: "all", sort: "date_asc", from: local(days[2]), to: local(days[4]) });
  assert.deepEqual(
    range.requests.map((r) => local(r.preferredAt)),
    [local(days[2]), local(days[3]), local(days[4])],
  );
  assert.equal(range.total, 3);
});
