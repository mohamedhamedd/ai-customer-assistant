// Integration tests: creating, listing and editing businesses against the
// local database. No OpenAI calls. Run with `npm run test:integration`.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/supabase";
import { findBusiness, forgetBusiness } from "@/lib/chat/turn";
import { businessProfile, createBusiness, listBusinesses, ProfileError, updateBusiness } from "./businesses";

const slugs: string[] = [];
const slug = () => {
  const s = `itest-${randomUUID().slice(0, 8)}`;
  slugs.push(s);
  return s;
};
after(async () => {
  await db().from("businesses").delete().in("slug", slugs);
});

const profile = (s: string) => ({
  name: "  Acme Fitness  ",
  slug: s,
  description: "A neighbourhood gym.",
  timezone: "America/Chicago",
  guidelines: "Never promise weight-loss results.",
});

const fieldError = (status: number, field: string) => (err: unknown) => err instanceof ProfileError && err.status === status && field in err.fields;

test("a new business is saved trimmed, and its assistant uses its profile at once", async () => {
  const s = slug();
  await createBusiness(profile(s));
  const business = await findBusiness(s);
  assert.equal(business?.name, "Acme Fitness");
  assert.equal(business?.guidelines, "Never promise weight-loss results.");
  assert.equal(business?.timezone, "America/Chicago");
});

test("a taken slug is a 409 on the slug field; bad fields are a 400 naming them", async () => {
  const s = slug();
  await createBusiness(profile(s));
  await assert.rejects(createBusiness(profile(s)), fieldError(409, "slug"));
  await assert.rejects(createBusiness({ ...profile(slug()), slug: "Not A Slug" }), fieldError(400, "slug"));
  await assert.rejects(createBusiness({ ...profile(slug()), slug: "new" }), fieldError(400, "slug"), "reserved for /admin/new");
  await assert.rejects(createBusiness({ ...profile(slug()), timezone: "Mars/Olympus" }), fieldError(400, "timezone"));
  await assert.rejects(createBusiness({ ...profile(slug()), name: " " }), fieldError(400, "name"));
  await assert.rejects(createBusiness({ ...profile(slug()), guidelines: "x".repeat(2001) }), fieldError(400, "guidelines"));
});

test("the database refuses a profile the form would refuse, whoever writes it", async () => {
  const { error } = await db().from("businesses").insert({ slug: "Bad Slug", name: "x" });
  assert.match(error?.message ?? "", /businesses_slug_format/);
  const { error: long } = await db().from("businesses").insert({ slug: slug(), name: "x", assistant_guidelines: "x".repeat(2001) });
  assert.match(long?.message ?? "", /businesses_guidelines_length/);
  const { error: reserved } = await db().from("businesses").insert({ slug: "new", name: "x" });
  assert.match(reserved?.message ?? "", /businesses_slug_format/, "'new' is /admin/new");
});

test("saving a profile applies to the next message, under the new slug; the old slug stops working", async () => {
  const s = slug();
  await createBusiness(profile(s));
  const before = await findBusiness(s); // now cached
  const renamed = slug();
  await updateBusiness({ id: before!.id, slug: s }, { ...profile(renamed), name: "Acme Fitness & Spa", guidelines: "" });
  assert.equal(await findBusiness(s), null, "the cached entry was dropped");
  const after = await findBusiness(renamed);
  assert.equal(after?.name, "Acme Fitness & Spa");
  assert.equal(after?.guidelines, "");
  assert.deepEqual(await businessProfile(before!.id), { ...profile(renamed), name: "Acme Fitness & Spa", guidelines: "" });
});

test("renaming to another business's slug is a 409 and changes nothing", async () => {
  const [a, b] = [slug(), slug()];
  await createBusiness(profile(a));
  await createBusiness(profile(b));
  const first = await findBusiness(a);
  await assert.rejects(updateBusiness({ id: first!.id, slug: a }, profile(b)), fieldError(409, "slug"));
  assert.equal((await businessProfile(first!.id)).slug, a);
});

test("the list counts ready documents only, and lists businesses without any", async () => {
  const s = slug();
  await createBusiness(profile(s));
  const id = (await findBusiness(s))!.id;
  const doc = (title: string, status: string) => ({ business_id: id, title, source_type: "md", content_hash: randomUUID(), embedding_model: "test", status });
  const { error } = await db().from("documents").insert([doc("Ready", "ready"), doc("Failed", "failed")]);
  assert.ifError(error);
  const empty = slug();
  await createBusiness(profile(empty));
  const list = await listBusinesses();
  assert.equal(list.find((b) => b.slug === s)?.documents, 1);
  assert.equal(list.find((b) => b.slug === empty)?.documents, 0);
});

test("a lookup that started before a save doesn't put the old profile back in the cache", async () => {
  const s = slug();
  await createBusiness(profile(s));
  // In flight (its query hasn't answered yet) when the save clears the cache.
  const inFlight = findBusiness(s);
  forgetBusiness(s);
  assert.equal((await inFlight)?.name, "Acme Fitness");
  // Changed behind the cache's back: only a fresh read can see it.
  await db().from("businesses").update({ name: "Changed" }).eq("slug", s);
  assert.equal((await findBusiness(s))?.name, "Changed", "the in-flight result wasn't cached");
});
