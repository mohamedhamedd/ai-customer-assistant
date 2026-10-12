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

test("the client address comes from the proxy header when there is one", () => {
  assert.equal(clientIp(new Request("http://x", { headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" } })), "203.0.113.7");
  assert.equal(clientIp(new Request("http://x")), "local");
});
