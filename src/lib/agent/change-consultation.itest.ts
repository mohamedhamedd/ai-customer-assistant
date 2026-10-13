// Integration tests: change_consultation_request, cancel_consultation_request
// and request_follow_up against the local database: the request found in
// this conversation, confirm before write, what's written and noted, a
// request the team has confirmed refused, and a follow-up in the admin. Run
// with `npm run test:integration`.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/supabase";
import { openFollowUps, setFollowUpStatus } from "@/lib/admin/crm";
import { conversationState } from "@/lib/chat/turn";
import { executeTool } from "./execute";
import { formatHuman, formatLocal, zonedLocalToUtc } from "./time";
import type { ToolContext } from "./tools";

const businesses: string[] = [];
after(async () => {
  // Their leads, conversations, messages, requests and tool calls go with them.
  await db().from("businesses").delete().in("id", businesses);
});

const TZ = "America/Chicago";
const day = (n: number) => formatLocal(new Date(Date.now() + n * 86_400_000), TZ).slice(0, 10);

async function withRequest(status = "pending") {
  const { data: business } = await db().from("businesses").insert({ slug: `itest-${randomUUID().slice(0, 8)}`, name: "Itest Clinic", timezone: TZ }).select("id").single();
  businesses.push(business!.id);
  const { data: lead } = await db().from("leads").insert({ business_id: business!.id, name: "Itest Sara", email: `itest-${randomUUID().slice(0, 8)}@example.com`, source_channel: "text" }).select("id, email").single();
  const { data: convo } = await db().from("conversations").insert({ business_id: business!.id, session_id: randomUUID(), lead_id: lead!.id }).select("id").single();
  const current = `${day(7)}T15:00`;
  const at = zonedLocalToUtc(current, TZ);
  assert.ok(at.ok);
  const { error } = await db().from("consultation_requests").insert({
    business_id: business!.id,
    lead_id: lead!.id,
    conversation_id: convo!.id,
    contact_name: "Itest Sara",
    contact_email: lead!.email,
    service: "Porcelain crown",
    preferred_at: at.at.toISOString(),
    status,
  });
  assert.ifError(error);
  const ctx: ToolContext = { businessId: business!.id, conversationId: convo!.id, channel: "text", timeZone: TZ, now: () => new Date() };
  const says = async (role: "user" | "assistant", content: string) => {
    const { error: e } = await db().from("messages").insert({ conversation_id: convo!.id, role, content });
    assert.ifError(e);
  };
  const change = async (args: object) => (await executeTool("change_consultation_request", JSON.stringify(args), ctx, { log: () => {}, trace: () => {} })).output;
  return { convo: convo!.id, current, at: at.at, says, change, ctx };
}

const executeToolFor = async (ctx: ToolContext, name: string, args: object) => (await executeTool(name, JSON.stringify(args), ctx, { log: () => {}, trace: () => {} })).output;

test("a pending request is changed after the customer's yes, with the change noted for staff", async () => {
  const r = await withRequest();
  const args = { current_datetime: r.current, preferred_datetime: `${day(8)}T10:00` };
  await r.says("user", "Can we move it to the next day at 10?");
  const proposal = await r.change(args);
  assert.ok(!proposal.ok && proposal.error === "confirm_first");
  assert.equal(proposal.details?.instead_of, formatHuman(r.at, TZ));
  const { count: before } = await db().from("consultation_requests").select("id", { count: "exact", head: true }).eq("conversation_id", r.convo).eq("service", "Porcelain crown").eq("preferred_at", r.at.toISOString());
  assert.equal(before, 1, "nothing changed yet");

  await r.says("assistant", "Just to confirm: the next day at 10:00 AM instead. Is that right?");
  await r.says("user", "yes");
  const done = await r.change(args);
  assert.ok(done.ok, JSON.stringify(done));
  const { data: rows } = await db().from("consultation_requests").select("service, preferred_at, notes, status").eq("conversation_id", r.convo);
  assert.equal(rows!.length, 1, "the same request, not a second one");
  assert.equal(formatLocal(new Date(rows![0].preferred_at), TZ), `${day(8)}T10:00`);
  assert.equal(rows![0].notes, `[Changed by the customer: was Porcelain crown, ${formatHuman(r.at, TZ)}.]`);
  assert.equal(rows![0].status, "pending");
});

test("a request the team has confirmed can't be changed", async () => {
  const r = await withRequest("confirmed");
  await r.says("user", "move it please");
  const out = await r.change({ current_datetime: r.current, preferred_datetime: `${day(8)}T10:00` });
  assert.ok(!out.ok && out.error === "request_not_pending");
  const { data } = await db().from("consultation_requests").select("preferred_at").eq("conversation_id", r.convo).single();
  assert.equal(new Date(data!.preferred_at).getTime(), r.at.getTime());
});

test("a pending request is cancelled after the customer's yes; the time is free again", async () => {
  const r = await withRequest();
  await r.says("user", "can you undo this request?");
  const cancel = await executeToolFor(r.ctx, "cancel_consultation_request", { current_datetime: r.current, reason: "changed my mind" });
  assert.ok(!cancel.ok && cancel.error === "confirm_first");
  await r.says("assistant", "Cancel your crown consultation? Is that right?");
  await r.says("user", "yes");
  const done = await executeToolFor(r.ctx, "cancel_consultation_request", { current_datetime: r.current });
  assert.ok(done.ok, JSON.stringify(done));
  const { data } = await db().from("consultation_requests").select("status, notes").eq("conversation_id", r.convo).single();
  assert.deepEqual(data, { status: "cancelled", notes: "[Cancelled by the customer: changed my mind.]" });
});

test("a follow-up is saved after the customer's yes, shows in the admin, and can be marked done", async () => {
  const r = await withRequest("confirmed");
  await r.says("user", "I need to cancel it, can someone call me?");
  const args = { reason: "Cancel the confirmed crown consultation. Prefers a phone call." };
  assert.equal((await executeToolFor(r.ctx, "request_follow_up", args)).error, "confirm_first");
  await r.says("assistant", "The team will call you about cancelling your confirmed crown consultation. Is that right?");
  await r.says("user", "yes");
  const done = await executeToolFor(r.ctx, "request_follow_up", args);
  assert.ok(done.ok, JSON.stringify(done));

  const { followUps, count } = await openFollowUps(r.ctx.businessId);
  assert.equal(count, 1);
  assert.deepEqual([followUps[0].customer, followUps[0].reason, followUps[0].conversationId], ["Itest Sara", args.reason, r.convo]);
  const state = await conversationState({ id: r.convo, lead_id: "x" }, TZ);
  assert.equal(state.followUp, args.reason, "the assistant sees it under Already done");

  await setFollowUpStatus(r.ctx.businessId, followUps[0].id, "done");
  assert.equal((await openFollowUps(r.ctx.businessId)).count, 0);
});

test("a request agreed but not saved yet is in the conversation's state until it's saved", async () => {
  const r = await withRequest();
  // A second conversation, with no contact saved yet.
  const { data: convo } = await db().from("conversations").insert({ business_id: r.ctx.businessId, session_id: randomUUID() }).select("id").single();
  const ctx: ToolContext = { ...r.ctx, conversationId: convo!.id };
  const says = async (role: "user" | "assistant", content: string) => void (await db().from("messages").insert({ conversation_id: convo!.id, role, content }));
  const args = { service: "Porcelain crown", preferred_datetime: `${day(9)}T15:00` };
  const state = () => conversationState({ id: convo!.id, lead_id: null }, TZ);

  await says("user", "A crown consultation at 3 that day please");
  assert.equal((await executeToolFor(ctx, "create_consultation_request", args)).error, "confirm_first");
  assert.equal((await state()).agreed?.waitingFor, "yes", "read back, waiting for the yes");

  await says("assistant", "Porcelain crown at 3:00 PM. Is that right?");
  await says("user", "yes");
  assert.equal((await executeToolFor(ctx, "create_consultation_request", args)).error, "lead_required");
  const agreed = (await state()).agreed;
  assert.deepEqual([agreed?.service, agreed?.preferredLocal, agreed?.waitingFor], ["Porcelain crown", `${day(9)}T15:00`, "contact"]);

  // Saved once the contact is there: no longer "not saved yet".
  const { data: lead } = await db().from("leads").insert({ business_id: ctx.businessId, name: "Itest Mo", phone: "5550001111", source_channel: "text" }).select("id").single();
  await db().from("conversations").update({ lead_id: lead!.id, customer_facts: { name: "Itest Mo", phone: "5550001111" } }).eq("id", convo!.id);
  assert.ok((await executeToolFor(ctx, "create_consultation_request", args)).ok);
  assert.equal((await state()).agreed, null);
});
