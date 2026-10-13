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
  const request = async (service: string) =>
    (await executeTool("create_consultation_request", JSON.stringify({ service, preferred_datetime: slot }), ctx, { log: () => {}, trace: () => {} })).output;
  return { says, request };
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
  assert.equal(proposal.details?.service, KIT, "read back under its exact name");
  assert.equal((await c.request("Porcelain crown")).error, "choose_service", "not an option they were offered");
});

test("the customer names one: its exact name; not offered: what can be requested", async () => {
  const c = await conversation([IN_OFFICE, KIT, "Porcelain crown"]);
  await c.says("user", "I'd like a crown please");
  const crown = await c.request("crown");
  assert.ok(!crown.ok && crown.error === "confirm_first" && crown.details?.service === "Porcelain crown");

  await c.says("user", "and gum surgery too");
  const gum = await c.request("gum surgery");
  assert.ok(!gum.ok && gum.error === "service_not_found");
  assert.deepEqual(gum.options, [IN_OFFICE, KIT, "Porcelain crown"]);
});

test("no services table: the service stays as the model wrote it", async () => {
  const c = await conversation([]);
  await c.says("user", "whitening please");
  const out = await c.request("teeth whitening");
  assert.ok(!out.ok && out.error === "confirm_first" && out.details?.service === "teeth whitening");
});
