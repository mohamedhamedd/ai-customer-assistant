// Integration tests: voice storage and the tool relay against the local
// database. No OpenAI calls (a call is opened directly in the database, and
// save_lead doesn't need the model). Needs `npm run db:start`.
// Run with `npm run test:integration`.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { db } from "@/lib/db/supabase";
import { env } from "@/lib/env";
import { ChatHttpError, conversationFor, findBusiness, loadHistory, recentHistory } from "@/lib/chat/turn";
import { CALL_EXPIRED, CALL_TIME_LIMIT, claimHangUp, recordVoiceItem, runVoiceTool } from "./voice";

const sessions: string[] = [];
after(async () => {
  for (const sessionId of sessions) await db().from("conversations").delete().eq("session_id", sessionId);
  await db().from("leads").delete().like("email", "voice-itest-%@example.com");
});

// What /api/voice/session does after OpenAI accepts the call.
async function openCall(opts: { sessionId?: string; expiresInMs?: number } = {}) {
  const sessionId = opts.sessionId ?? randomUUID();
  if (!opts.sessionId) sessions.push(sessionId);
  const business = (await findBusiness(env().DEMO_BUSINESS_SLUG))!;
  const conversation = await conversationFor(business.id, sessionId);
  const callToken = randomBytes(32).toString("base64url");
  const { data, error } = await db()
    .from("voice_calls")
    .insert({
      conversation_id: conversation.id,
      token_hash: createHash("sha256").update(callToken).digest("hex"),
      expires_at: new Date(Date.now() + (opts.expiresInMs ?? 60_000)).toISOString(),
    })
    .select("id")
    .single();
  assert.ifError(error);
  return { callToken, callId: data!.id, sessionId, conversationId: conversation.id };
}

const item = () => `item_${randomUUID().replaceAll("-", "")}`;
const businessSlug = () => env().DEMO_BUSINESS_SLUG;
const isExpired = (err: unknown) => err instanceof ChatHttpError && err.status === 401 && err.message === CALL_EXPIRED;
const isOverTime = (err: unknown) => err instanceof ChatHttpError && err.status === 401 && err.message === CALL_TIME_LIMIT;

// Confirm before write, as a voice call does it: the model's first call
// proposes the details (nothing saved), it reads them back, the customer
// answers. The next call with the same details commits.
async function proposeAndAnswer(callToken: string, name: string, args: object) {
  const proposal = await runVoiceTool({ callToken, callId: `call_${randomUUID()}`, name, arguments: JSON.stringify(args) });
  assert.equal((proposal.output as { error?: string }).error, "confirm_first");
  await recordVoiceItem({ callToken, itemId: item(), role: "user", transcript: "Yes, that's right." });
}

test("voice messages keep conversation order even when the question's transcript arrives last", async () => {
  const { callToken, sessionId } = await openCall();
  const question = item();
  const answer = item();
  await recordVoiceItem({ callToken, itemId: question, role: "user" });
  await recordVoiceItem({ callToken, itemId: answer, role: "assistant" });
  await recordVoiceItem({ callToken, itemId: answer, role: "assistant", transcript: "We're open nine to five." });
  await recordVoiceItem({ callToken, itemId: question, role: "user", transcript: "  When are you open?  " });

  const history = await loadHistory(businessSlug(), sessionId);
  assert.deepEqual(
    history.map((m) => [m.role, m.channel, m.content]),
    [
      ["user", "voice", "When are you open?"],
      ["assistant", "voice", "We're open nine to five."],
    ],
  );
});

test("reporting an item twice stores it once; an empty transcript stays null", async () => {
  const { callToken, conversationId } = await openCall();
  const cough = item();
  await recordVoiceItem({ callToken, itemId: cough, role: "user" });
  await recordVoiceItem({ callToken, itemId: cough, role: "user" });
  await recordVoiceItem({ callToken, itemId: cough, role: "user", transcript: "   " });

  const { data } = await db().from("messages").select("content").eq("conversation_id", conversationId);
  assert.deepEqual(data, [{ content: null }]);
  // Null rows never reach the model.
  assert.deepEqual(await recentHistory(conversationId), []);
});

test("a transcript reported before its item is still stored", async () => {
  const { callToken, sessionId } = await openCall();
  await recordVoiceItem({ callToken, itemId: item(), role: "user", transcript: "Hello" });
  const history = await loadHistory(businessSlug(), sessionId);
  assert.deepEqual(history.map((m) => m.content), ["Hello"]);
});

test("without a live call's secret nothing runs and nothing is stored", async () => {
  const { conversationId } = await openCall();
  const forged = randomBytes(32).toString("base64url");
  await assert.rejects(runVoiceTool({ callToken: forged, callId: "call_x", name: "save_lead", arguments: "{}" }), isExpired);
  await assert.rejects(recordVoiceItem({ callToken: forged, itemId: item(), role: "user", transcript: "hi" }), isExpired);

  const expired = await openCall({ expiresInMs: -1000 });
  const email = `voice-itest-${randomUUID().slice(0, 8)}@example.com`;
  await assert.rejects(
    runVoiceTool({ callToken: expired.callToken, callId: "call_y", name: "save_lead", arguments: JSON.stringify({ name: "Late", email }) }),
    isOverTime,
    "past its time limit: refused, with the time-limit message",
  );
  const { count } = await db().from("leads").select("id", { count: "exact", head: true }).eq("email", email);
  assert.equal(count, 0, "an expired call can't save a lead");
  const { count: calls } = await db().from("tool_calls").select("id", { count: "exact", head: true }).eq("conversation_id", conversationId);
  assert.equal(calls, 0);
});

test("an answer's cards come from exactly the tool calls it used, once", async () => {
  const { callToken, conversationId } = await openCall();
  const email = `voice-itest-${randomUUID().slice(0, 8)}@example.com`;
  await recordVoiceItem({ callToken, itemId: item(), role: "user", transcript: `I'm Sam, ${email}` });
  await proposeAndAnswer(callToken, "save_lead", { name: "Sam Voice", email });
  const args = JSON.stringify({ name: "Sam Voice", email });
  const relayed = await runVoiceTool({ callToken, callId: "call_a", name: "save_lead", arguments: args });
  assert.equal(relayed.output.ok, true);
  assert.equal(relayed.action?.kind, "lead_saved");
  // The model repeats the call: still one card.
  await runVoiceTool({ callToken, callId: "call_b", name: "save_lead", arguments: args });

  const answer = item();
  await recordVoiceItem({ callToken, itemId: answer, role: "assistant", toolCallIds: ["call_a", "call_b"] });
  // A later answer naming the same tool calls gets nothing: already attached.
  const later = item();
  await recordVoiceItem({ callToken, itemId: later, role: "assistant", toolCallIds: ["call_a", "call_b"] });

  const { data } = await db().from("messages").select("id, actions").eq("conversation_id", conversationId).in("client_message_id", [answer, later]).order("id");
  assert.deepEqual(data![0].actions, [{ kind: "lead_saved", details: { name: "Sam Voice", email } }]);
  assert.deepEqual(data![1].actions, []);

  const { data: calls } = await db().from("tool_calls").select("channel, message_id").eq("conversation_id", conversationId).in("realtime_call_id", ["call_a", "call_b"]);
  assert.ok(calls!.length === 2 && calls!.every((c) => c.channel === "voice" && c.message_id === data![0].id), "audited as voice, linked to the answer");
});

test("another call can't borrow a call's tool results, even in the same conversation", async () => {
  const first = await openCall();
  const second = await openCall({ sessionId: first.sessionId });
  const email = `voice-itest-${randomUUID().slice(0, 8)}@example.com`;
  await proposeAndAnswer(first.callToken, "save_lead", { name: "First", email });
  const saved = await runVoiceTool({ callToken: first.callToken, callId: "call_1", name: "save_lead", arguments: JSON.stringify({ name: "First", email }) });
  assert.equal(saved.output.ok, true);

  const borrower = item();
  await recordVoiceItem({ callToken: second.callToken, itemId: borrower, role: "assistant", toolCallIds: ["call_1"] });
  const { data } = await db().from("messages").select("actions").eq("conversation_id", first.conversationId).eq("client_message_id", borrower);
  assert.deepEqual(data, [{ actions: [] }]);
});

test("an answer's citations come from the server's own tool calls", async () => {
  const { callToken, callId, sessionId, conversationId } = await openCall();
  const source = { documentId: randomUUID(), title: "Pricing", heading: "Whitening", excerpt: "$349", similarity: 0.6 };
  await db().from("tool_calls").insert({
    conversation_id: conversationId,
    voice_call_id: callId,
    realtime_call_id: "call_search",
    channel: "voice",
    name: "search_knowledge",
    arguments: {},
    result: { ok: true, found: true },
    ok: true,
    duration_ms: 5,
    sources: [source],
  });
  await recordVoiceItem({ callToken, itemId: item(), role: "assistant", toolCallIds: ["call_search"] });

  const history = await loadHistory(businessSlug(), sessionId);
  assert.deepEqual(history.at(-1)!.sources, [source]);
});

test("voice: a save only proposes until the customer has answered; the yes needs no transcript yet", async () => {
  const { callToken, conversationId } = await openCall();
  const email = `voice-itest-${randomUUID().slice(0, 8)}@example.com`;
  const save = (callId: string) =>
    runVoiceTool({ callToken, callId, name: "save_lead", arguments: JSON.stringify({ name: "Sam Spoken", email, phone: "503 555 0142" }) });

  // Details and save in the same breath: a proposal, no card.
  await recordVoiceItem({ callToken, itemId: item(), role: "user", transcript: `Save me, Sam Spoken, ${email}, 503 555 0142` });
  const proposal = await save("call_propose");
  assert.equal((proposal.output as { error?: string }).error, "confirm_first");
  assert.deepEqual((proposal.output as { details?: object }).details, { name: "Sam Spoken", email, phone: "5035550142" });
  assert.equal(proposal.action, null);
  assert.equal(((await save("call_again")).output as { error?: string }).error, "confirm_first", "the same response again: still a proposal");

  // The customer answers. Their item is stored when they start speaking,
  // before its transcript: that's enough, the call doesn't wait for it.
  await recordVoiceItem({ callToken, itemId: item(), role: "user" });
  const committed = await save("call_yes");
  assert.equal(committed.output.ok, true);
  assert.equal(committed.action?.kind, "lead_saved");
  const { data: lead } = await db().from("leads").select("phone").eq("email", email).single();
  assert.equal(lead!.phone, "5035550142");
  const { data: audit } = await db().from("tool_calls").select("ok").eq("conversation_id", conversationId).order("id");
  assert.deepEqual(audit!.map((a) => a.ok), [false, false, true]);
});

test("an unknown tool name is refused as a tool error, not a crash", async () => {
  const { callToken } = await openCall();
  const relayed = await runVoiceTool({ callToken, callId: "call_z", name: "delete_everything", arguments: "{}" });
  assert.equal(relayed.output.ok, false);
  assert.equal(relayed.action, null);
});

test("a hang-up is claimed once, then again only after a minute", async () => {
  const { callId } = await openCall({ expiresInMs: -1000 });
  const now = Date.now();
  assert.equal(await claimHangUp(callId, now), true, "first attempt");
  assert.equal(await claimHangUp(callId, now + 1_000), false, "a second request right after: skipped");
  const [a, b] = await Promise.all([claimHangUp(callId, now + 61_000), claimHangUp(callId, now + 61_000)]);
  assert.equal(Number(a) + Number(b), 1, "after a minute, exactly one of two concurrent requests retries");
});
