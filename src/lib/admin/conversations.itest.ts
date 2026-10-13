// Integration tests: conversation review against the local database. No
// OpenAI calls. Needs `npm run db:start`. Run with `npm run test:integration`.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/supabase";
import type { Json } from "@/lib/db/database.types";
import { ChatHttpError } from "@/lib/chat/turn";
import { conversationTranscript, knowledgeGaps, listConversations } from "./conversations";
import { leadDetail, overview } from "./crm";

const businesses: string[] = [];
let mine: string;
let theirs: string;
let textConv: string;
let voiceConv: string;
let theirConv: string;
let lead: string;

async function business(name: string) {
  const { data, error } = await db().from("businesses").insert({ slug: `itest-${randomUUID().slice(0, 8)}`, name }).select("id").single();
  assert.ifError(error);
  businesses.push(data!.id);
  return data!.id;
}

async function conversation(businessId: string, leadId: string | null = null) {
  const { data, error } = await db().from("conversations").insert({ business_id: businessId, session_id: randomUUID(), lead_id: leadId }).select("id").single();
  assert.ifError(error);
  return data!.id;
}

async function message(conversationId: string, role: "user" | "assistant", content: string | null, channel: "text" | "voice" = "text") {
  const { data, error } = await db().from("messages").insert({ conversation_id: conversationId, role, content, channel }).select("id").single();
  assert.ifError(error);
  return data!.id;
}

async function toolCall(conversationId: string, name: string, args: Json, result: Json, ok = true, messageId: number | null = null) {
  const { data, error } = await db()
    .from("tool_calls")
    .insert({ conversation_id: conversationId, channel: messageId ? "voice" : "text", name, arguments: args as NonNullable<Json>, result: result as NonNullable<Json>, ok, duration_ms: 12, message_id: messageId })
    .select("id")
    .single();
  assert.ifError(error);
  return data!.id;
}

before(async () => {
  mine = await business("Mine");
  theirs = await business("Theirs");
  const { data: l } = await db().from("leads").insert({ business_id: mine, name: "Sara Ali", email: "sara@example.com", source_channel: "text" }).select("id").single();
  lead = l!.id;

  // Text: question, its tools, answer; in that order, as a turn stores them.
  textConv = await conversation(mine, lead);
  await message(textConv, "user", "How much is whitening?");
  await toolCall(textConv, "search_knowledge", { query: "whitening price" }, { ok: true, found: true, results: [{}] });
  await message(textConv, "assistant", "It's $450.");
  await message(textConv, "user", "Do you offer sedation for kids?");
  await toolCall(textConv, "search_knowledge", { query: "sedation for kids" }, { ok: true, found: false });
  await toolCall(textConv, "save_lead", { name: "Sara" }, { ok: false, error: "invalid_input", message: "email: missing" }, false);
  await message(textConv, "assistant", "I don't have that information.");

  // Voice: the tool ran before the customer's words were stored (their
  // transcript arrived late); the answer it was linked to is exact.
  voiceConv = await conversation(mine);
  const early = await toolCall(voiceConv, "search_knowledge", { query: "saturday hours" }, { ok: true, found: true, results: [] });
  await message(voiceConv, "user", "Are you open Saturday?", "voice");
  await message(voiceConv, "user", null, "voice");
  const answer = await message(voiceConv, "assistant", "Yes, 9 to 1.", "voice");
  await db().from("tool_calls").update({ message_id: answer }).eq("id", early);

  // Opened, never written in: not listed.
  await conversation(mine);

  theirConv = await conversation(theirs);
  await message(theirConv, "user", "Theirs");
  await toolCall(theirConv, "search_knowledge", { query: "their gap" }, { ok: true, found: false });
});
after(async () => {
  for (const id of businesses) await db().from("businesses").delete().eq("id", id);
});

const notFound = (err: unknown) => err instanceof ChatHttpError && err.status === 404;

test("the list: this business only, newest activity first, with counts, channels, lead and preview", async () => {
  const { items: list, total } = await listConversations(mine);
  assert.equal(total, 2, "the total counts what the list shows");
  assert.deepEqual(
    list.map((c) => [c.id, c.lead?.name ?? null, c.messages, c.channels, c.preview]),
    [
      [voiceConv, null, 3, ["voice"], "Yes, 9 to 1."],
      [textConv, "Sara Ali", 4, ["text"], "I don't have that information."],
    ],
    "the empty conversation and the other business's are left out",
  );
});

test("the transcript: tool calls between the question and the answer, failures included", async () => {
  const t = await conversationTranscript(mine, textConv);
  assert.equal(t.conversation.lead?.name, "Sara Ali");
  assert.deepEqual(
    t.items.map((i) => (i.kind === "tool" ? `${i.name}${i.ok ? "" : " ✗"}` : i.role)),
    ["user", "search_knowledge", "assistant", "user", "search_knowledge", "save_lead ✗", "assistant"],
  );
  assert.equal(t.earlierOmitted, false);
});

test("voice: a linked tool call sits right before its answer, even if it ran before the question was stored", async () => {
  const t = await conversationTranscript(mine, voiceConv);
  assert.deepEqual(
    t.items.map((i) => (i.kind === "tool" ? "tool" : `${i.role}:${i.content ?? "-"}`)),
    ["user:Are you open Saturday?", "user:-", "tool", "assistant:Yes, 9 to 1."],
  );
});

test("another business's conversation is a 404, like one that doesn't exist", async () => {
  await assert.rejects(conversationTranscript(mine, theirConv), notFound);
  await assert.rejects(conversationTranscript(mine, randomUUID()), notFound);
});

test("unanswered questions: searches that found nothing, this business only", async () => {
  // A search that failed (an outage) is not a gap in the documents.
  await toolCall(textConv, "search_knowledge", { query: "outage" }, { ok: false, error: "temporarily_unavailable" }, false);
  const gaps = await knowledgeGaps(mine);
  assert.deepEqual(
    gaps.map((g) => [g.query, g.conversationId]),
    [["sedation for kids", textConv]],
  );
});

test("a lead's detail links to its conversations", async () => {
  const detail = await leadDetail(mine, lead);
  assert.deepEqual(
    detail.conversations.map((c) => c.id),
    [textConv],
  );
});

test("issues: a replaced answer and a failed save show in the transcript, the issues list and the overview, for this business only", async () => {
  const issueConv = await conversation(mine);
  const question = await message(issueConv, "user", "How much is a crown?");
  const { data: answer, error } = await db()
    .from("messages")
    .insert({
      conversation_id: issueConv,
      role: "assistant",
      content: "I don't have that exact information.",
      reply_to_message_id: question,
      replaced_original: "A crown is $999.",
      replaced_reason: "Not in the documents or the conversation: $999",
    })
    .select("id")
    .single();
  assert.ifError(error);
  // Another business's issue must not show here.
  await toolCall(theirConv, "save_lead", {}, { ok: false, error: "temporarily_unavailable", message: "…" }, false);

  const t = await conversationTranscript(mine, issueConv);
  const replaced = t.items.find((i) => i.kind === "message" && i.id === answer!.id);
  assert.deepEqual(replaced?.kind === "message" ? replaced.replaced : null, { original: "A crown is $999.", reason: "Not in the documents or the conversation: $999" });

  // A failed save in the text conversation: also an issue. A proposal
  // (confirm_first) or invalid input is the conversation working: not one.
  await toolCall(textConv, "save_lead", {}, { ok: false, error: "outcome_unknown", message: "…" }, false);
  const { items: all } = await listConversations(mine);
  assert.deepEqual(
    Object.fromEntries(all.map((c) => [c.id, c.hasIssue])),
    { [issueConv]: true, [textConv]: true, [voiceConv]: false },
  );
  const { items: issues } = await listConversations(mine, { issuesOnly: true });
  assert.deepEqual(issues.map((c) => c.id).sort(), [issueConv, textConv].sort());

  // Also the search outage from the unanswered-questions test above.
  const o = await overview(mine);
  assert.equal(o.issues7d, 3);
  assert.deepEqual(
    o.recentIssues.map((i) => [i.kind, i.conversationId, i.label]).sort(),
    [
      ["replaced_answer", issueConv, "Answer replaced: Not in the documents or the conversation: $999"],
      ["tool_failed", textConv, "save_lead failed: outcome unknown"],
      ["tool_failed", textConv, "search_knowledge failed: temporarily unavailable"],
    ].sort(),
  );
});

test("the list comes in pages of 25, newest first, with the total; a page past the end is empty", async () => {
  const many = await business("Many");
  const ids: string[] = [];
  for (let i = 0; i < 27; i++) {
    const id = await conversation(many);
    await message(id, "user", `Question ${i}`);
    ids.push(id);
  }
  const first = await listConversations(many);
  assert.deepEqual([first.items.length, first.total, first.page, first.pageSize], [25, 27, 1, 25]);
  assert.equal(first.items[0].id, ids[26], "newest activity first");
  const second = await listConversations(many, { page: 2 });
  assert.deepEqual(
    second.items.map((c) => c.id),
    [ids[1], ids[0]],
  );
  const past = await listConversations(many, { page: 9 });
  assert.deepEqual([past.items.length, past.total], [0, 27]);
});
