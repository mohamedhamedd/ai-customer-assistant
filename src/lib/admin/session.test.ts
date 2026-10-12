import { test } from "node:test";
import assert from "node:assert/strict";
import { SESSION_TTL_MS, sameSecret, signSession, verifySession } from "./session";

const PASSWORD = "correct horse battery";
const now = Date.parse("2026-10-12T12:00:00Z");

test("a session signed with the password verifies until it expires", () => {
  const token = signSession(PASSWORD, now);
  assert.equal(verifySession(token, PASSWORD, now + 1000), true);
  assert.equal(verifySession(token, PASSWORD, now + SESSION_TTL_MS + 1), false, "expired");
});

test("a changed password signs everyone out", () => {
  assert.equal(verifySession(signSession(PASSWORD, now), "new password 123", now), false);
});

test("forged or tampered cookies don't verify", () => {
  const [, signature] = signSession(PASSWORD, now).split(".");
  const later = now + 10 * SESSION_TTL_MS;
  assert.equal(verifySession(`${later}.${signature}`, PASSWORD, now), false, "extended expiry, old signature");
  assert.equal(verifySession(`${now + 1000}.forged`, PASSWORD, now), false);
  assert.equal(verifySession("garbage", PASSWORD, now), false);
  assert.equal(verifySession(`${now + 1000}.${signature}.extra`, PASSWORD, now), false);
  assert.equal(verifySession(undefined, PASSWORD, now), false);
});

test("password comparison works for any lengths", () => {
  assert.equal(sameSecret("abc", "abc"), true);
  assert.equal(sameSecret("abc", "abcd"), false);
});
