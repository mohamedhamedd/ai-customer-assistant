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

test("requests over a limit get a 429 with a friendly message; limits are independent", async () => {
  const session = { key: `${prefix}:session`, windowSeconds: 60, max: 2 };
  const ip = { key: `${prefix}:ip`, windowSeconds: 60, max: 100 };
  await enforce([session, ip]);
  await enforce([session, ip]);
  await assert.rejects(enforce([session, ip]), (err: unknown) => err instanceof ChatHttpError && err.status === 429 && err.message === TOO_MANY);
  await enforce([{ ...session, key: `${prefix}:other-session` }, ip]);
});

test("client-supplied forwarding headers are ignored unless a proxy is trusted", () => {
  const spoofed = new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4" } });
  assert.equal(clientIp(spoofed, false), null, "no trusted proxy: unknown, never the client's claim");
  assert.equal(clientIp(new Request("http://x"), true), null);
});

test("behind a trusted proxy: X-Real-IP, else the address the proxy appended", () => {
  // The client sent "6.6.6.6"; the proxy appended the real address last.
  const appended = new Request("http://x", { headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.7" } });
  assert.equal(clientIp(appended, true), "203.0.113.7");
  const real = new Request("http://x", { headers: { "x-real-ip": "198.51.100.2", "x-forwarded-for": "6.6.6.6" } });
  assert.equal(clientIp(real, true), "198.51.100.2");
});
