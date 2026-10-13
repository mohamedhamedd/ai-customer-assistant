// Integration tests: a business's tables (services, opening hours) in a chat
// turn, against the local database, with a scripted model (no OpenAI
// calls). Run with `npm run test:integration`.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ChatCompletionChunk, ChatCompletionCreateParamsStreaming } from "openai/resources/chat/completions";
import { db } from "@/lib/db/supabase";
import { emptyRow } from "@/lib/admin/service-rows";
import { saveHours } from "@/lib/admin/hours";
import { saveServices } from "@/lib/admin/services";
import { prepareChatTurn, runChatTurn, type ChatEvent, type ChatTurnDeps } from "./turn";

const businesses: string[] = [];
after(async () => {
  // Their conversations go with them.
  await db().from("businesses").delete().in("id", businesses);
});

const chunk = (content: string): ChatCompletionChunk => ({ id: "c", object: "chat.completion.chunk", created: 0, model: "fake", choices: [{ index: 0, delta: { content }, finish_reason: null }] });

// Answers with the given text, and keeps the system prompt it was sent.
function answers(text: string) {
  const prompts: string[] = [];
  const deps: ChatTurnDeps = {
    complete: async (params: ChatCompletionCreateParamsStreaming) => {
      prompts.push(String(params.messages[0].content));
      return (async function* () {
        yield chunk(text);
      })();
    },
  };
  return { deps, prompts };
}

async function business() {
  const slug = `itest-${randomUUID().slice(0, 8)}`;
  const { data, error } = await db().from("businesses").insert({ slug, name: "Itest Dental", timezone: "America/Chicago" }).select("id").single();
  assert.ifError(error);
  businesses.push(data!.id);
  await saveServices(data!.id, [{ ...emptyRow(), name: "Traditional braces (full treatment)", category: "Orthodontics", price: "$4,000 to $6,000" }]);
  await saveHours(data!.id, { hours: [{ day: 1, opens: "08:00", closes: "17:00" }], lastStartBeforeClose: 60, notes: "Closed on major US public holidays.", closed: [] });
  return slug;
}

async function turn(slug: string, message: string, deps: ChatTurnDeps) {
  const input = { businessSlug: slug, sessionId: randomUUID(), clientMessageId: randomUUID(), message };
  const prepared = await prepareChatTurn(input);
  if (prepared.kind !== "run") throw new Error("not run");
  const events: ChatEvent[] = [];
  await runChatTurn(prepared, input, (e) => void events.push(e), deps);
  const { data } = await db().from("messages").select("content, replaced_reason, sources").eq("reply_to_message_id", prepared.userMessageId).single();
  return { events, saved: data! };
}

test("the turn's prompt has the business's tables, and a price quoted from them passes the answer check", async () => {
  const slug = await business();
  const model = answers("Traditional braces (full treatment) are $4,000 to $6,000. We're open Monday 8:00 AM to 5:00 PM.");
  const { events, saved } = await turn(slug, "How much are braces, and when are you open?", model.deps);
  assert.ok(model.prompts[0].includes("- Traditional braces (full treatment) (category: Orthodontics; price: $4,000 to $6,000)"));
  assert.ok(model.prompts[0].includes("- Monday: 8:00 AM to 5:00 PM"));
  assert.ok(model.prompts[0].includes("The last appointment starts 1 hour before closing.\nNotes on these hours (they qualify the days above): Closed on major US public holidays."));
  assert.equal(saved.replaced_reason, null);
  assert.ok(!events.some((e) => e.type === "replace"));

  // Chips for the rows it quoted, live and in what's saved.
  const live = events.flatMap((e) => (e.type === "sources" ? e.sources : []));
  assert.deepEqual(
    live.map((s) => [s.title, s.table]),
    [
      ["Services", "services"],
      ["Opening hours", "hours"],
    ],
  );
  assert.ok(live[0].excerpt.includes("| Traditional braces (full treatment) | $4,000 to $6,000 | – |"));
  assert.deepEqual(saved.sources, live);
});

test("an answer from the documents only gets no table chip", async () => {
  const slug = await business();
  const { events } = await turn(slug, "Do you have parking?", answers("I don't have information about parking. Would you like someone from the team to get back to you?").deps);
  assert.deepEqual(
    events.flatMap((e) => (e.type === "sources" ? e.sources : [])),
    [],
  );
});

test("a price that isn't in the tables (or anywhere else it could know) is still replaced", async () => {
  const slug = await business();
  const { saved } = await turn(slug, "How much are braces?", answers("Traditional braces (full treatment) are $3,200.").deps);
  assert.notEqual(saved.replaced_reason, null);
  assert.deepEqual(saved.sources, [], "a replaced answer cites nothing");
});
