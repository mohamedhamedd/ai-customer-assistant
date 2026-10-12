// Integration tests: the admin knowledge base against the local database.
// No OpenAI calls (documents are inserted directly). Needs `npm run db:start`.
// Run with `npm run test:integration`.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/supabase";
import { ChatHttpError } from "@/lib/chat/turn";
import { deleteDocument, documentSections, listDocuments } from "./knowledge";

const businesses: string[] = [];
let mine: string;
let theirs: string;
let theirDoc: string;
let myDoc: string;

async function business(name: string) {
  const { data, error } = await db().from("businesses").insert({ slug: `itest-${randomUUID().slice(0, 8)}`, name }).select("id").single();
  assert.ifError(error);
  businesses.push(data!.id);
  return data!.id;
}

async function document(businessId: string, title: string, sections: string[]) {
  const { data, error } = await db()
    .from("documents")
    .insert({ business_id: businessId, title, source_type: "md", content_hash: randomUUID(), embedding_model: "test", status: "ready", chunk_count: sections.length })
    .select("id")
    .single();
  assert.ifError(error);
  const zero = JSON.stringify(Array(1536).fill(0));
  const { error: chunkError } = await db()
    .from("chunks")
    .insert(sections.map((content, i) => ({ document_id: data!.id, business_id: businessId, chunk_index: i, heading: `Part ${i + 1}`, content, token_count: 3, embedding: zero })));
  assert.ifError(chunkError);
  return data!.id;
}

before(async () => {
  mine = await business("Mine");
  theirs = await business("Theirs");
  myDoc = await document(mine, "My prices", ["Cleaning is $129.", "Whitening is $349."]);
  theirDoc = await document(theirs, "Their prices", ["Secret pricing."]);
});
after(async () => {
  for (const id of businesses) await db().from("businesses").delete().eq("id", id);
});

const notFound = (err: unknown) => err instanceof ChatHttpError && err.status === 404;

test("the list shows only this business's documents", async () => {
  const docs = await listDocuments(mine);
  assert.deepEqual(
    docs.map((d) => [d.title, d.status, d.sections]),
    [["My prices", "ready", 2]],
  );
});

test("sections come back in order, for this business only", async () => {
  const doc = await documentSections(mine, myDoc);
  assert.deepEqual(
    doc.sections.map((s) => [s.heading, s.content]),
    [
      ["Part 1", "Cleaning is $129."],
      ["Part 2", "Whitening is $349."],
    ],
  );
  await assert.rejects(documentSections(mine, theirDoc), notFound, "another business's document is not found");
});

test("deleting needs the right business, and removes the chunks with it", async () => {
  await assert.rejects(deleteDocument(mine, theirDoc), notFound);
  const { count: still } = await db().from("chunks").select("id", { count: "exact", head: true }).eq("document_id", theirDoc);
  assert.equal(still, 1, "their document is untouched");

  await deleteDocument(mine, myDoc);
  const { count } = await db().from("chunks").select("id", { count: "exact", head: true }).eq("document_id", myDoc);
  assert.equal(count, 0, "no chunks left for the assistant to find");
  await assert.rejects(deleteDocument(mine, myDoc), notFound, "deleting twice is a 404");
});
