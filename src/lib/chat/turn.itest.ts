// Integration tests: the turn orchestration against the local database, with
// a fake model (no OpenAI calls, no cost). Needs `npm run db:start`.
// Run with `npm run test:integration`.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ChatCompletionChunk } from "openai/resources/chat/completions";
import { db } from "@/lib/db/supabase";
import { env } from "@/lib/env";
import {
  AI_UNAVAILABLE,
  BUSY_MESSAGE,
  ChatHttpError,
  HISTORY_PAGE,
  loadHistory,
  prepareChatTurn,
  runChatTurn,
  type ChatEvent,
  type ChatTurnDeps,
  type ChatTurnInput,
  UNKNOWN_BUSINESS,
} from "./turn";

const sessions: string[] = [];
after(async () => {
  for (const sessionId of sessions) await db().from("conversations").delete().eq("session_id", sessionId);
});

function newInput(sessionId: string, message = "Hello"): ChatTurnInput {
  return { businessSlug: env().DEMO_BUSINESS_SLUG, sessionId, clientMessageId: randomUUID(), message };
}

function session(): string {
  const id = randomUUID();
  sessions.push(id);
  return id;
}

const replies = (text: string): ChatTurnDeps => ({
  complete: async () =>
    (async function* (): AsyncGenerator<ChatCompletionChunk> {
      yield { id: "c", object: "chat.completion.chunk", created: 0, model: "fake", choices: [{ index: 0, delta: { content: text }, finish_reason: "stop" }] };
    })(),
});

const failing: ChatTurnDeps = {
  complete: async () => {
    throw new Error("model unavailable");
  },
};

async function run(input: ChatTurnInput, deps: ChatTurnDeps) {
  const prepared = await prepareChatTurn(input);
  const events: ChatEvent[] = [];
  if (prepared.kind === "run") await runChatTurn(prepared, input, (e) => void events.push(e), deps);
  return { prepared, events };
}

async function userMessage(clientMessageId: string) {
  const { data } = await db().from("messages").select("id, reply_failed_at").eq("client_message_id", clientMessageId).single();
  return data!;
}

test("a turn stores the question and its reply, linked", async () => {
  const input = newInput(session());
  const { events } = await run(input, replies("Hi! How can I help?"));
  assert.deepEqual(events.map((e) => e.type), ["start", "delta", "sources", "done"]);
  const done = events.at(-1) as Extract<ChatEvent, { type: "done" }>;
  const { data: reply } = await db().from("messages").select("content, reply_to_message_id").eq("id", done.messageId).single();
  assert.equal(reply!.content, "Hi! How can I help?");
  assert.equal(reply!.reply_to_message_id, (await userMessage(input.clientMessageId)).id);
});

test("resending the same message replays the stored reply without running the model", async () => {
  const input = newInput(session());
  await run(input, replies("Stored answer."));
  const again = await prepareChatTurn(input);
  assert.equal(again.kind, "replay");
  if (again.kind === "replay") assert.equal(again.reply.content, "Stored answer.");
});

test("a model failure marks the turn failed; one retry re-runs at once, a concurrent one gets 409", async () => {
  const input = newInput(session(), "Where do I park?");
  const { events } = await run(input, failing);
  assert.deepEqual(events.at(-1), { type: "error", message: AI_UNAVAILABLE, retryable: true });
  assert.notEqual((await userMessage(input.clientMessageId)).reply_failed_at, null);

  const first = await prepareChatTurn(input);
  assert.equal(first.kind, "run", "the failed turn is re-run immediately, not after 60 s");
  await assert.rejects(prepareChatTurn(input), (err: unknown) => err instanceof ChatHttpError && err.status === 409);

  if (first.kind === "run") await runChatTurn(first, input, () => {}, replies("Free parking behind the building."));
  const after = await prepareChatTurn(input);
  assert.equal(after.kind, "replay");
});

test("a second message while the first is still being answered gets 409", async () => {
  const sessionId = session();
  const first = await prepareChatTurn(newInput(sessionId, "first"));
  assert.equal(first.kind, "run");
  await assert.rejects(
    prepareChatTurn(newInput(sessionId, "second")),
    (err: unknown) => err instanceof ChatHttpError && err.status === 409 && err.message === BUSY_MESSAGE,
  );
});

test("history returns the newest page of a long conversation, oldest first", async () => {
  const sessionId = session();
  await run(newInput(sessionId, "first question"), replies("first answer"));
  const { data: conversation } = await db().from("conversations").select("id").eq("session_id", sessionId).single();
  const rows = Array.from({ length: HISTORY_PAGE + 5 }, (_, i) => ({
    conversation_id: conversation!.id,
    role: "assistant",
    content: `filler ${i}`,
  }));
  await db().from("messages").insert(rows);

  const history = await loadHistory(env().DEMO_BUSINESS_SLUG, sessionId);
  assert.equal(history.length, HISTORY_PAGE);
  assert.equal(history.at(-1)!.content, `filler ${HISTORY_PAGE + 4}`, "ends with the newest message");
  assert.equal(history[0].content, "filler 5", "the oldest messages are the ones left out");
});

test("an unknown business slug is a 404, before anything is stored", async () => {
  const input = { ...newInput(session()), businessSlug: "no-such-business" };
  await assert.rejects(prepareChatTurn(input), (err: unknown) => err instanceof ChatHttpError && err.status === 404 && err.message === UNKNOWN_BUSINESS);
  const { count } = await db().from("conversations").select("id", { count: "exact", head: true }).eq("session_id", input.sessionId);
  assert.equal(count, 0);
});

test("the same browser session gets a separate conversation per business", async () => {
  const slug = `itest-${randomUUID().slice(0, 8)}`;
  const { error } = await db().from("businesses").insert({ slug, name: "Other Business", description: "", timezone: "America/Toronto" });
  assert.ifError(error);
  try {
    const sessionId = session();
    await run(newInput(sessionId, "question for the demo business"), replies("demo answer"));
    await run({ ...newInput(sessionId, "question for the other business"), businessSlug: slug }, replies("other answer"));

    const demo = await loadHistory(env().DEMO_BUSINESS_SLUG, sessionId);
    const other = await loadHistory(slug, sessionId);
    assert.deepEqual(demo.map((m) => m.content), ["question for the demo business", "demo answer"]);
    assert.deepEqual(other.map((m) => m.content), ["question for the other business", "other answer"]);
  } finally {
    const { data: business } = await db().from("businesses").select("id").eq("slug", slug).single();
    await db().from("conversations").delete().eq("business_id", business!.id);
    await db().from("businesses").delete().eq("slug", slug);
  }
});
