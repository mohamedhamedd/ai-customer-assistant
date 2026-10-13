// Integration tests: a business's services table, against the local
// database, with a fake model (no OpenAI calls). Run with
// `npm run test:integration`.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/supabase";
import { emptyRow, type ServiceRow } from "./service-rows";
import { fillServicesIfEmpty, listServices, saveServices, ServicesError, suggestServices, type SuggestModel } from "./services";

const businesses: string[] = [];
after(async () => {
  await db().from("businesses").delete().in("id", businesses);
});

const ZERO = JSON.stringify(Array(1536).fill(0));

async function business(document: string | null = null) {
  const { data, error } = await db().from("businesses").insert({ slug: `itest-${randomUUID().slice(0, 8)}`, name: "Acme Fitness", timezone: "America/Chicago" }).select("id").single();
  assert.ifError(error);
  businesses.push(data!.id);
  if (document !== null) {
    const documentId = randomUUID();
    const { error: docError } = await db()
      .from("documents")
      .insert({ id: documentId, business_id: data!.id, title: "Services", source_type: "md", content_hash: randomUUID(), embedding_model: "test", status: "ready", chunk_count: 1 });
    assert.ifError(docError);
    const { error: chunkError } = await db().from("chunks").insert({ document_id: documentId, business_id: data!.id, chunk_index: 0, heading: "Sessions", content: document, token_count: 10, embedding: ZERO });
    assert.ifError(chunkError);
  }
  return data!.id;
}

const training: ServiceRow = { ...emptyRow(), name: "Personal training session", category: "Sessions", price: "$60", duration: "60 minutes" };
const trial: ServiceRow = { ...emptyRow(), name: "Group class trial", price: "Free" };

test("the list is saved in order, replaced as a whole, and kept per business", async () => {
  const mine = await business();
  const theirs = await business();
  await saveServices(theirs, [trial]);

  assert.deepEqual(await saveServices(mine, [training, { ...trial, requestable: false }]), [training, { ...trial, requestable: false }]);
  assert.deepEqual(await saveServices(mine, [trial]), [trial], "replaced, not added to");
  assert.deepEqual(await listServices(mine), [trial]);
  assert.deepEqual(await listServices(theirs), [trial], "another business's list is untouched");
});

test("a list with problems is refused with each one on its row, and nothing changes", async () => {
  const mine = await business();
  await saveServices(mine, [training]);
  await assert.rejects(
    saveServices(mine, [trial, { ...trial, name: "group CLASS trial" }, { ...training, price: "x".repeat(61) }]),
    (err: unknown) =>
      err instanceof ServicesError &&
      err.status === 400 &&
      JSON.stringify(err.rows) ===
        JSON.stringify([
          { row: 1, field: "name", message: "Already listed in row 1." },
          { row: 2, field: "price", message: "Keep the price under 60 characters." },
        ]),
  );
  assert.deepEqual(await listServices(mine), [training]);
});

const DOC = "We offer a Personal training session (60 minutes, $60) and a Group class trial (Free). Smoothies at the bar.";

function model(services: unknown[]) {
  const seen: string[] = [];
  const fake: SuggestModel = async (documents) => (seen.push(documents), { services });
  return { fake, seen };
}

test("rows suggested from the documents keep only what's written there", async () => {
  const mine = await business(DOC);
  const m = model([
    { name: "Personal training session", category: "Sessions", price: "$60", duration: "60 minutes", requestable: true },
    { name: "Yoga retreat", category: "", price: "$900", duration: "", requestable: true },
  ]);
  assert.deepEqual(await suggestServices(mine, m.fake), [{ ...training, requestable: true }]);
  assert.match(m.seen[0], /## Sessions\nWe offer a Personal training session/);
});

test("after documents are added, an empty table is filled; a saved one is never replaced; no documents, no model call", async () => {
  const mine = await business(DOC);
  const first = model([{ name: "Group class trial", category: "", price: "Free", duration: "", requestable: true }]);
  assert.deepEqual(await fillServicesIfEmpty(mine, first.fake), [trial]);
  assert.deepEqual(await listServices(mine), [trial]);

  const again = model([{ name: "Personal training session", category: "", price: "", duration: "", requestable: true }]);
  assert.deepEqual(await fillServicesIfEmpty(mine, again.fake), []);
  assert.equal(again.seen.length, 0, "already has services: no model call");

  const empty = await business();
  const none = model([{ name: "Anything", category: "", price: "", duration: "", requestable: true }]);
  assert.deepEqual(await fillServicesIfEmpty(empty, none.fake), []);
  assert.equal(none.seen.length, 0);

  const failing: SuggestModel = async () => {
    throw new Error("model down");
  };
  const other = await business(DOC);
  assert.deepEqual(await fillServicesIfEmpty(other, failing), [], "a failing model doesn't fail the upload");
});
