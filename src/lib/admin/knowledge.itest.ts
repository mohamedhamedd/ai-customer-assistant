// Integration tests: the admin knowledge base against the local database.
// No OpenAI calls (documents are inserted directly). Needs `npm run db:start`.
// Run with `npm run test:integration`.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/supabase";
import { ChatHttpError } from "@/lib/chat/turn";
import { env } from "@/lib/env";
import { deleteDocument, documentSections, INTERRUPTED, listDocuments, uploadDocument } from "./knowledge";

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

async function document(businessId: string, title: string, sections: string[], extra: { status?: string; created_at?: string } = {}) {
  const { data, error } = await db()
    .from("documents")
    .insert({
      business_id: businessId,
      title,
      source_type: "md",
      content_hash: randomUUID(),
      embedding_model: env().OPENAI_EMBEDDING_MODEL,
      status: "ready",
      chunk_count: sections.length,
      ...extra,
    })
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

test("an upload that died mid-way shows as interrupted, not 'Processing' forever", async () => {
  const business = await (async () => {
    const { data } = await db().from("businesses").insert({ slug: `itest-${randomUUID().slice(0, 8)}`, name: "Stale" }).select("id").single();
    businesses.push(data!.id);
    return data!.id;
  })();
  await document(business, "Fresh upload", [], { status: "processing" });
  await document(business, "Died an hour ago", [], { status: "processing", created_at: new Date(Date.now() - 60 * 60_000).toISOString() });

  const docs = await listDocuments(business);
  const byTitle = Object.fromEntries(docs.map((d) => [d.title, [d.status, d.error]]));
  assert.deepEqual(byTitle["Fresh upload"], ["processing", null], "a recent one is still running");
  assert.deepEqual(byTitle["Died an hour ago"], ["failed", INTERRUPTED]);
});

test("a new file with an existing document's title is caught before anything is embedded", async () => {
  const file = new File(["# Their Prices \n\nNew prices for everything."], "prices-v2.md");
  const result = await uploadDocument(theirs, file);
  assert.equal(result.status, "title_taken");
  assert.equal(result.status === "title_taken" && result.existingDocumentId, theirDoc, "names the document to replace");

  const { data } = await db().from("documents").select("title").eq("business_id", theirs).ilike("title", "their prices");
  assert.equal(data!.length, 1, "nothing new stored");
});
