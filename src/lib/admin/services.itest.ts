// Integration tests: suggesting a business's services from its documents,
// against the local database, with a fake model (no OpenAI calls). Run with
// `npm run test:integration`.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/supabase";
import { findBusiness } from "@/lib/chat/turn";
import { fillServicesIfEmpty, suggestServices, type SuggestModel } from "./services";

const businesses: string[] = [];
after(async () => {
  await db().from("businesses").delete().in("id", businesses);
});

const ZERO = JSON.stringify(Array(1536).fill(0));

async function business(withDocument: string | null) {
  const slug = `itest-${randomUUID().slice(0, 8)}`;
  const { data, error } = await db().from("businesses").insert({ slug, name: "Acme Fitness", timezone: "America/Chicago" }).select("id").single();
  assert.ifError(error);
  businesses.push(data!.id);
  if (withDocument !== null) {
    const documentId = randomUUID();
    const { error: docError } = await db()
      .from("documents")
      .insert({ id: documentId, business_id: data!.id, title: "Services", source_type: "md", content_hash: randomUUID(), embedding_model: "test", status: "ready", chunk_count: 1 });
    assert.ifError(docError);
    const { error: chunkError } = await db()
      .from("chunks")
      .insert({ document_id: documentId, business_id: data!.id, chunk_index: 0, heading: "Sessions", content: withDocument, token_count: 10, embedding: ZERO });
    assert.ifError(chunkError);
  }
  return { id: data!.id, slug };
}

// A model that answers with these names, and counts its calls.
function model(services: string[]) {
  const seen: string[] = [];
  const fake: SuggestModel = async (documents) => (seen.push(documents), { services });
  return { fake, seen };
}

const DOC = "We offer a Personal training session (60 minutes) and a Group class trial. Nutrition advice is included.";

test("the suggestion reads the business's documents and keeps only names written there", async () => {
  const b = await business(DOC);
  const m = model(["Personal training session", "Group class trial", "Yoga retreat"]);
  assert.deepEqual(await suggestServices(b.id, m.fake), ["Personal training session", "Group class trial"]);
  assert.match(m.seen[0], /## Sessions\nWe offer a Personal training session/);
});

test("after an upload, an empty list is filled and used by the next message; a saved list is never replaced", async () => {
  const b = await business(DOC);
  const first = model(["Personal training session", "Group class trial"]);
  assert.deepEqual(await fillServicesIfEmpty(b.id, first.fake), ["Personal training session", "Group class trial"]);
  assert.deepEqual((await findBusiness(b.slug))?.services, ["Personal training session", "Group class trial"]);

  const again = model(["Group class trial"]);
  assert.deepEqual(await fillServicesIfEmpty(b.id, again.fake), [], "already has a list");
  assert.equal(again.seen.length, 0, "no model call");
  assert.deepEqual((await findBusiness(b.slug))?.services, ["Personal training session", "Group class trial"]);
});

test("no documents: nothing suggested, no model call; a failing model doesn't fail the upload", async () => {
  const empty = await business(null);
  const m = model(["Anything"]);
  assert.deepEqual(await suggestServices(empty.id, m.fake), []);
  assert.equal(m.seen.length, 0);

  const b = await business(DOC);
  const failing: SuggestModel = async () => {
    throw new Error("model down");
  };
  assert.deepEqual(await fillServicesIfEmpty(b.id, failing), []);
  assert.deepEqual((await findBusiness(b.slug))?.services, []);
});
