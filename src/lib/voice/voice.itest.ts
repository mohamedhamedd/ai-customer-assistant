// Integration tests: voice storage and the tool relay against the local
// database. No OpenAI calls (save_lead doesn't need the model). Needs
// `npm run db:start`. Run with `npm run test:integration`.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/supabase";
import { env } from "@/lib/env";
import { loadHistory, recentHistory } from "@/lib/chat/turn";
import { recordVoiceItem, runVoiceTool } from "./voice";

const sessions: string[] = [];
after(async () => {
  for (const sessionId of sessions) await db().from("conversations").delete().eq("session_id", sessionId);
  await db().from("leads").delete().like("email", "voice-itest-%@example.com");
});

function target() {
  const sessionId = randomUUID();
  sessions.push(sessionId);
  return { businessSlug: env().DEMO_BUSINESS_SLUG, sessionId };
}

const item = () => `item_${randomUUID().replaceAll("-", "")}`;

async function conversationId(sessionId: string) {
  const { data } = await db().from("conversations").select("id").eq("session_id", sessionId).single();
  return data!.id;
}

test("voice messages keep conversation order even when the question's transcript arrives last", async () => {
  const t = target();
  const question = item();
  const answer = item();
  await recordVoiceItem({ ...t, itemId: question, role: "user" });
  await recordVoiceItem({ ...t, itemId: answer, role: "assistant" });
  await recordVoiceItem({ ...t, itemId: answer, role: "assistant", transcript: "We're open nine to five." });
  await recordVoiceItem({ ...t, itemId: question, role: "user", transcript: "  When are you open?  " });

  const history = await loadHistory(t.businessSlug, t.sessionId);
  assert.deepEqual(
    history.map((m) => [m.role, m.channel, m.content]),
    [
      ["user", "voice", "When are you open?"],
      ["assistant", "voice", "We're open nine to five."],
    ],
  );
});

test("reporting an item twice stores it once; an empty transcript stays null", async () => {
  const t = target();
  const cough = item();
  await recordVoiceItem({ ...t, itemId: cough, role: "user" });
  await recordVoiceItem({ ...t, itemId: cough, role: "user" });
  await recordVoiceItem({ ...t, itemId: cough, role: "user", transcript: "   " });

  const { data } = await db().from("messages").select("content").eq("conversation_id", await conversationId(t.sessionId));
  assert.deepEqual(data, [{ content: null }]);
  // Null rows never reach the model.
  assert.deepEqual(await recentHistory(await conversationId(t.sessionId)), []);
});

test("a transcript reported before its item is still stored", async () => {
  const t = target();
  const said = item();
  await recordVoiceItem({ ...t, itemId: said, role: "user", transcript: "Hello" });
  const history = await loadHistory(t.businessSlug, t.sessionId);
  assert.deepEqual(history.map((m) => m.content), ["Hello"]);
});

test("a voice answer's cards come from the tools the server ran, once per answer", async () => {
  const t = target();
  await recordVoiceItem({ ...t, itemId: item(), role: "user", transcript: "I'm Sam, sam's email follows" });
  const email = `voice-itest-${randomUUID().slice(0, 8)}@example.com`;
  const args = JSON.stringify({ name: "Sam Voice", email });
  const relayed = await runVoiceTool({ ...t, name: "save_lead", arguments: args });
  assert.equal(relayed.output.ok, true);
  assert.equal(relayed.action?.kind, "lead_saved");
  // The model repeats the call: still one card.
  await runVoiceTool({ ...t, name: "save_lead", arguments: args });

  const answer = item();
  await recordVoiceItem({ ...t, itemId: answer, role: "assistant" });
  const next = item();
  await recordVoiceItem({ ...t, itemId: next, role: "assistant" });

  const { data } = await db()
    .from("messages")
    .select("client_message_id, actions")
    .eq("conversation_id", await conversationId(t.sessionId))
    .eq("role", "assistant")
    .order("id");
  assert.deepEqual(data![0].actions, [{ kind: "lead_saved", details: { name: "Sam Voice", email } }]);
  assert.deepEqual(data![1].actions, [], "the next answer doesn't repeat the card");

  const { data: calls } = await db().from("tool_calls").select("channel").eq("conversation_id", await conversationId(t.sessionId));
  assert.ok(calls!.every((c) => c.channel === "voice"), "audited as voice");
});

test("a voice answer's citations come from the server's own tool calls", async () => {
  const t = target();
  await recordVoiceItem({ ...t, itemId: item(), role: "user", transcript: "Prices?" });
  const source = { documentId: randomUUID(), title: "Pricing", heading: "Whitening", excerpt: "$349", similarity: 0.6 };
  await db()
    .from("tool_calls")
    .insert({ conversation_id: await conversationId(t.sessionId), channel: "voice", name: "search_knowledge", arguments: {}, result: { ok: true, found: true }, ok: true, duration_ms: 5, sources: [source] });
  await recordVoiceItem({ ...t, itemId: item(), role: "assistant" });

  const history = await loadHistory(t.businessSlug, t.sessionId);
  assert.deepEqual(history.at(-1)!.sources, [source]);
});

test("an unknown tool name is refused as a tool error, not a crash", async () => {
  const t = target();
  const relayed = await runVoiceTool({ ...t, name: "delete_everything", arguments: "{}" });
  assert.equal(relayed.output.ok, false);
  assert.equal(relayed.action, null);
});
