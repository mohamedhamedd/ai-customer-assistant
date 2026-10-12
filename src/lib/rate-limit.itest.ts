// Integration test: the rate limiter against the local database.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/supabase";
import { ChatHttpError } from "@/lib/chat/turn";
import { clientIp, enforce, TOO_MANY } from "./rate-limit";

const prefix = `itest:${randomUUID()}`;
after(async () => {
  await db().from("rate_limit_hits").delete().like("key", `${prefix}%`);
});

const tooMany = (err: unknown) => err instanceof ChatHttpError && err.status === 429 && err.message === TOO_MANY;

async function hits(key: string) {
  const { data } = await db().from("rate_limit_hits").select("hits").eq("key", key);
  return (data ?? []).reduce((sum, r) => sum + r.hits, 0);
}

test("requests over a limit get a 429 with a friendly message; limits are independent", async () => {
  const session = { key: `${prefix}:session`, windowSeconds: 60, max: 2 };
  const ip = { key: `${prefix}:ip`, windowSeconds: 60, max: 100 };
  await enforce([[session, ip]]);
  await enforce([[session, ip]]);
  await assert.rejects(enforce([[session, ip]]), tooMany);
  await enforce([[{ ...session, key: `${prefix}:other-session` }, ip]]);
});

test("a request a visitor limit turns away doesn't spend the business ceiling", async () => {
  const visitor = { key: `${prefix}:visitor`, windowSeconds: 60, max: 1 };
  const business = { key: `${prefix}:business`, windowSeconds: 60, max: 100 };
  await enforce([[visitor], [business]]);
  for (let i = 0; i < 5; i++) await assert.rejects(enforce([[visitor], [business]]), tooMany);
  assert.equal(await hits(business.key), 1, "only the request that got through counted");
});

test("no trusted header configured: the address is unknown, whatever the client sends", () => {
  const spoofed = new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8" } });
  assert.equal(clientIp(spoofed, undefined), null);
});

test("x-forwarded-for: the last entry, the one the proxy appended", () => {
  const appended = new Request("http://x", { headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.7" } });
  assert.equal(clientIp(appended, "x-forwarded-for"), "203.0.113.7");
});

test("another proxy header is read as is, and only that one", () => {
  const cf = new Request("http://x", { headers: { "cf-connecting-ip": "198.51.100.2", "x-forwarded-for": "6.6.6.6", "x-real-ip": "6.6.6.6" } });
  assert.equal(clientIp(cf, "cf-connecting-ip"), "198.51.100.2");
  assert.equal(clientIp(new Request("http://x"), "cf-connecting-ip"), null, "header missing: unknown");
});
