import { test } from "node:test";
import assert from "node:assert/strict";
import { fieldErrors, profileSchema, slugify } from "./profile";

const valid = { name: "Acme Fitness", slug: "acme-fitness", description: "", timezone: "America/Chicago", guidelines: "" };

test("slug suggestion: lowercase words joined by single dashes, accents dropped", () => {
  assert.equal(slugify("Acme Fitness & Spa"), "acme-fitness-spa");
  assert.equal(slugify("  Café Olé!  "), "cafe-ole");
  assert.equal(slugify("---"), "");
  assert.equal(slugify("a".repeat(70)).length, 64);
  assert.ok(profileSchema.safeParse({ ...valid, slug: slugify("Northside Plumbing, Inc.") }).success, "a suggestion is always valid");
});

test("a valid profile passes, trimmed", () => {
  const parsed = profileSchema.parse({ ...valid, name: "  Acme Fitness ", guidelines: " Be kind. \n" });
  assert.equal(parsed.name, "Acme Fitness");
  assert.equal(parsed.guidelines, "Be kind.");
});

test("each bad field gets its own message", () => {
  const result = profileSchema.safeParse({ name: "", slug: "Acme_Fitness", description: "x".repeat(501), timezone: "Mars/Base", guidelines: "x".repeat(2001) });
  assert.ok(!result.success);
  assert.deepEqual(Object.keys(fieldErrors(result.error)).sort(), ["description", "guidelines", "name", "slug", "timezone"]);
});

test("slugs: no double or trailing dash, and 'new' is reserved for /admin/new", () => {
  for (const slug of ["acme--fitness", "-acme", "acme-", "new"]) assert.ok(!profileSchema.safeParse({ ...valid, slug }).success, slug);
  assert.ok(profileSchema.safeParse({ ...valid, slug: "new-wave-gym" }).success);
  assert.ok(profileSchema.safeParse({ ...valid, timezone: "UTC" }).success);
});

test("timezones: any IANA name, old or new spelling; never an offset", () => {
  for (const timezone of ["Asia/Kolkata", "Asia/Calcutta", "America/Argentina/Buenos_Aires", "Etc/GMT+5"]) assert.ok(profileSchema.safeParse({ ...valid, timezone }).success, timezone);
  for (const timezone of ["+05:00", "Mars/Olympus", "America", "", "PST"]) assert.ok(!profileSchema.safeParse({ ...valid, timezone }).success, timezone);
});
