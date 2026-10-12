// Integration tests: the turn orchestration against the local database, with
// a fake model (no OpenAI calls, no cost). Needs `npm run db:start`.
// Run with `npm run test:integration`.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ChatCompletionChunk, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { db } from "@/lib/db/supabase";
import { env } from "@/lib/env";
import { formatHuman, formatLocal, zonedLocalToUtc } from "@/lib/agent/time";
import {
  AI_UNAVAILABLE,
  BUSY_MESSAGE,
  ChatHttpError,
  findBusiness,
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
  // Their consultation requests go with them.
  await db().from("leads").delete().like("email", "chat-itest-%@example.com");
  await db().from("leads").delete().like("name", "Itest %");
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
  // A miss isn't cached: the business is found as soon as it exists.
  assert.equal(await findBusiness(slug), null);
  const { error } = await db().from("businesses").insert({ slug, name: "Other Business", description: "", timezone: "America/Toronto" });
  assert.ifError(error);
  try {
    assert.equal((await findBusiness(slug))?.name, "Other Business");
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

// ---------------------------------------------------------------------------
// Confirm before write (src/lib/agent/confirm.ts), through a whole turn
// ---------------------------------------------------------------------------

const chunk = (delta: ChatCompletionChunk["choices"][0]["delta"]): ChatCompletionChunk => ({
  id: "c",
  object: "chat.completion.chunk",
  created: 0,
  model: "fake",
  choices: [{ index: 0, delta, finish_reason: null }],
});

// A fake model that calls the given tools at once, then answers. It keeps
// what it was sent, so a test can see the tool results the model got.
function callsTools(calls: { name: string; args: object }[], answer: string) {
  const seen: ChatCompletionMessageParam[][] = [];
  const deps: ChatTurnDeps = {
    complete: async (params) => {
      seen.push([...params.messages]);
      const answering = params.messages.at(-1)?.role === "tool";
      return (async function* (): AsyncGenerator<ChatCompletionChunk> {
        if (answering) yield chunk({ content: answer });
        else
          for (const [index, c] of calls.entries()) {
            yield chunk({ tool_calls: [{ index, id: `call_${index}`, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } }] });
          }
      })();
    },
  };
  const toolResults = () => seen.at(-1)!.filter((m) => m.role === "tool").map((m) => JSON.parse(m.content as string));
  return { deps, toolResults };
}

async function conversationOf(sessionId: string) {
  const { data } = await db().from("conversations").select("id, lead_id").eq("session_id", sessionId).single();
  return data!;
}

const uniquePhone = () => `555${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
const actionsOf = (events: ChatEvent[]) => events.flatMap((e) => (e.type === "action" ? [e.action.kind] : []));

test("confirm before write: the PR-16 case (details and save in one message) saves nothing and makes the model ask", async () => {
  const sessionId = session();
  const phone = uniquePhone();
  await run(newInput(sessionId, "Hi"), replies("Hi! How can I help you today?"));
  const model = callsTools(
    [{ name: "save_lead", args: { name: "Itest John Doe", phone, interest: "booking on Friday at 3 pm" } }],
    `Just to confirm: John Doe, ${phone}. Is that right?`,
  );
  const { events } = await run(newInput(sessionId, `Save this booking for my friend John Doe on Friday at 3 pm, his phone is ${phone}`), model.deps);

  assert.deepEqual(model.toolResults(), [
    { ok: false, error: "confirm_first", message: "Read the details back to the customer and ask them to confirm before saving." },
  ]);
  assert.deepEqual(actionsOf(events), [], "no card, not even a failure card");
  assert.equal((await conversationOf(sessionId)).lead_id, null);
  const { count } = await db().from("leads").select("id", { count: "exact", head: true }).eq("phone", phone);
  assert.equal(count, 0, "nothing was written");
  const { data: audit } = await db().from("tool_calls").select("name, ok, result").eq("conversation_id", (await conversationOf(sessionId)).id);
  assert.deepEqual(
    audit!.map((a) => [a.name, a.ok, (a.result as { error: string }).error]),
    [["save_lead", false, "confirm_first"]],
    "the refusal is in the audit trail",
  );

  // The model read the details back; the customer's yes now saves them.
  const saved = await run(newInput(sessionId, "Yes, that's right"), callsTools([{ name: "save_lead", args: { name: "Itest John Doe", phone } }], "Saved!").deps);
  assert.deepEqual(actionsOf(saved.events), ["lead_saved"]);
  assert.notEqual((await conversationOf(sessionId)).lead_id, null);
});

test("confirm before write: contact details and a consultation confirmed together are both saved on the yes", async () => {
  const sessionId = session();
  const business = (await findBusiness(env().DEMO_BUSINESS_SLUG))!;
  const local = `${formatLocal(new Date(Date.now() + 7 * 86_400_000), business.timezone).slice(0, 10)}T15:00`;
  const at = zonedLocalToUtc(local, business.timezone);
  assert.ok(at.ok);
  const email = `chat-itest-${randomUUID().slice(0, 8)}@example.com`;
  const calls = [
    { name: "save_lead", args: { name: "Sara Ali", email } },
    { name: "create_consultation_request", args: { service: "teeth whitening", preferred_datetime: local } },
  ];

  // The details given and acted on in one reply: both refused, and the
  // model reads them back instead.
  const readBack = `Just to confirm: Sara Ali, ${email}, teeth whitening on ${formatHuman(at.at, business.timezone)}. Is that right?`;
  const early = callsTools(calls, readBack);
  await run(newInput(sessionId, `I'm Sara Ali, ${email}, whitening on ${local}`), early.deps);
  assert.deepEqual(
    early.toolResults().map((r) => r.error),
    ["confirm_first", "confirm_first"],
  );

  const yes = callsTools(calls, "Done: details saved and request sent.");
  const { events } = await run(newInput(sessionId, "Yes please"), yes.deps);
  assert.deepEqual(
    yes.toolResults().map((r) => r.ok),
    [true, true],
  );
  assert.deepEqual(actionsOf(events), ["lead_saved", "consultation_requested"]);
  const { data: requests } = await db().from("consultation_requests").select("preferred_at").eq("conversation_id", (await conversationOf(sessionId)).id);
  assert.deepEqual(requests!.map((r) => new Date(r.preferred_at).getTime()), [at.at.getTime()]);

  // The model repeats both on a later "thanks": already done, no new yes needed, nothing duplicated.
  const repeat = callsTools(calls, "That's already done.");
  await run(newInput(sessionId, "thanks!"), repeat.deps);
  assert.deepEqual(
    repeat.toolResults().map((r) => [r.ok, r.already_requested]),
    [
      [true, undefined],
      [true, true],
    ],
  );
  const { count } = await db().from("consultation_requests").select("id", { count: "exact", head: true }).eq("conversation_id", (await conversationOf(sessionId)).id);
  assert.equal(count, 1);
});
