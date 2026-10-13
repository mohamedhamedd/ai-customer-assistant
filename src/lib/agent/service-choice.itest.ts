// Integration tests: a consultation's service, checked against the business's
// services table and the customer's messages in the local database
// (service-choice.ts). Run with `npm run test:integration`.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/supabase";
import { emptyRow } from "@/lib/admin/service-rows";
import { saveServices } from "@/lib/admin/services";
import { executeTool } from "./execute";
import { formatLocal } from "./time";
import type { ToolContext } from "./tools";

const businesses: string[] = [];
after(async () => {
  // Their conversations, messages and tool calls go with them.
  await db().from("businesses").delete().in("id", businesses);
});

const TZ = "America/Chicago";
const IN_OFFICE = "In-office teeth whitening (single session)";
const KIT = "Take-home whitening kit (custom trays and gel)";

async function conversation(services: string[]) {
  const { data: business, error } = await db().from("businesses").insert({ slug: `itest-${randomUUID().slice(0, 8)}`, name: "Itest Dental", timezone: TZ }).select("id").single();
  assert.ifError(error);
  businesses.push(business!.id);
  await saveServices(business!.id, services.map((name) => ({ ...emptyRow(), name })));
  const { data: convo, error: convoError } = await db().from("conversations").insert({ business_id: business!.id, session_id: randomUUID() }).select("id").single();
  assert.ifError(convoError);
  const ctx: ToolContext = { businessId: business!.id, conversationId: convo!.id, channel: "text", timeZone: TZ, now: () => new Date() };
  const says = async (role: "user" | "assistant", content: string) => {
    const { error: e } = await db().from("messages").insert({ conversation_id: convo!.id, role, content });
    assert.ifError(e);
  };
  const request = async (service: string | string[]) =>
    (await executeTool("create_consultation_request", JSON.stringify({ [typeof service === "string" ? "service" : "services"]: service, preferred_datetime: slot }), ctx, { log: () => {}, trace: () => {} })).output;
  // The customer's contact, saved as save_lead would (a request needs it).
  const contact = async () => {
    const { data: lead, error: e } = await db().from("leads").insert({ business_id: business!.id, name: "Itest Ana", phone: "5550606001", source_channel: "text" }).select("id").single();
    assert.ifError(e);
    const { error: e2 } = await db().from("conversations").update({ lead_id: lead!.id, customer_facts: { name: "Itest Ana", phone: "5550606001" } }).eq("id", convo!.id);
    assert.ifError(e2);
  };
  const stored = async () => (await db().from("consultation_requests").select("services, service").eq("conversation_id", convo!.id)).data ?? [];
  return { says, request, contact, stored };
}

const slot = `${formatLocal(new Date(Date.now() + 7 * 86_400_000), TZ).slice(0, 10)}T15:00`;

test("several fit: the agent must ask, and only the customer's answer to the options goes through", async () => {
  const c = await conversation([IN_OFFICE, KIT, "Porcelain crown"]);
  await c.says("user", "Can I come in for whitening next week at 3?");
  const ask = await c.request("teeth whitening");
  assert.ok(!ask.ok && ask.error === "choose_service");
  assert.deepEqual(ask.options, [IN_OFFICE, KIT]);
  assert.equal((await c.request(KIT)).error, "choose_service", "not before the customer has answered");

  await c.says("assistant", "In-office whitening, or the take-home kit?");
  await c.says("user", "the second one");
  const proposal = await c.request(KIT);
  assert.ok(!proposal.ok && proposal.error === "confirm_first");
  assert.deepEqual(proposal.details?.services, [KIT], "read back under its exact name");
  assert.equal((await c.request("Porcelain crown")).error, "choose_service", "not an option they were offered");
});

test("a plain yes picks nothing from several options; from one, it's the answer", async () => {
  const c = await conversation([IN_OFFICE, KIT, "Porcelain crown"]);
  await c.says("user", "I'm Omar, 5550303001. I want whitening tomorrow at 2pm");
  assert.equal((await c.request("whitening")).error, "choose_service");
  // Seen live: the options and the contact read-back in one reply; the yes was to the contact.
  await c.says("assistant", "Just to confirm: Omar, 5550303001. Is that right? And in-office whitening, or the take-home kit?");
  await c.says("user", "yes");
  assert.equal((await c.request(IN_OFFICE)).error, "choose_service", "the model can't take the yes as in-office");
  await c.says("user", "in office");
  assert.equal((await c.request(IN_OFFICE)).error, "confirm_first");

  const d = await conversation([IN_OFFICE, KIT, "Traditional braces (full treatment)"]);
  await d.says("user", "Can you fix my overbite?");
  assert.deepEqual((await d.request("Traditional braces (full treatment)")).options, ["Traditional braces (full treatment)"]);
  await d.says("user", "yes");
  assert.equal((await d.request("Traditional braces (full treatment)")).error, "confirm_first");
});

test("the customer names one: its exact name; not offered: what can be requested", async () => {
  const c = await conversation([IN_OFFICE, KIT, "Porcelain crown"]);
  await c.says("user", "I'd like a crown please");
  const crown = await c.request("crown");
  assert.ok(!crown.ok && crown.error === "confirm_first" && JSON.stringify(crown.details?.services) === JSON.stringify(["Porcelain crown"]));

  await c.says("user", "and gum surgery too");
  const gum = await c.request("gum surgery");
  assert.ok(!gum.ok && gum.error === "service_not_found");
  assert.deepEqual(gum.options, [IN_OFFICE, KIT, "Porcelain crown"]);
});

test("one visit, two services: read back together, saved as one request", async () => {
  const c = await conversation([IN_OFFICE, KIT, "Porcelain crown"]);
  await c.contact();
  await c.says("user", "I'd like a porcelain crown and the take-home whitening kit next week at 3");
  const proposal = await c.request(["crown", "take-home kit"]);
  assert.ok(!proposal.ok && proposal.error === "confirm_first");
  assert.deepEqual(proposal.details?.services, ["Porcelain crown", KIT], "each by its exact name");
  await c.says("assistant", `Porcelain crown and ${KIT}, next week at 3:00 PM. Is that right?`);
  await c.says("user", "yes");
  const done = await c.request(["Porcelain crown", KIT]);
  assert.ok(done.ok && done.already_requested === false);
  assert.deepEqual(await c.stored(), [{ services: ["Porcelain crown", KIT], service: `Porcelain crown, ${KIT}` }]);
  // Another visit at that time isn't this one: refused, never "already requested".
  await c.says("user", "and in-office teeth whitening at the same time");
  assert.equal((await c.request([IN_OFFICE])).error, "confirm_first");
  await c.says("assistant", `${IN_OFFICE}, next week at 3:00 PM. Is that right?`);
  await c.says("user", "yes");
  const other = await c.request([IN_OFFICE]);
  assert.ok(!other.ok && other.error === "slot_taken" && other.message.includes(`for Porcelain crown, ${KIT}`));
  assert.equal((await c.stored()).length, 1);
});

test("no services table: the service stays as the model wrote it", async () => {
  const c = await conversation([]);
  await c.says("user", "whitening please");
  const out = await c.request("teeth whitening");
  assert.ok(!out.ok && out.error === "confirm_first" && JSON.stringify(out.details?.services) === JSON.stringify(["teeth whitening"]));
});
