import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// The admin session cookie: "<expiry ms>.<hmac>", signed with a key derived
// from ADMIN_PASSWORD. Nothing to store server-side; changing the password
// signs everyone out. Pure, so it is unit-tested.

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const key = (password: string) => createHash("sha256").update(`admin-session-key:${password}`).digest();
const mac = (password: string, expiry: number) => createHmac("sha256", key(password)).update(`admin-session:v1:${expiry}`).digest("base64url");

// Compares digests of the same length, so neither the content nor the
// length of a wrong guess leaks through timing.
export function sameSecret(a: string, b: string): boolean {
  const da = createHash("sha256").update(a).digest();
  const db = createHash("sha256").update(b).digest();
  return timingSafeEqual(da, db);
}

export function signSession(password: string, now = Date.now()): string {
  const expiry = now + SESSION_TTL_MS;
  return `${expiry}.${mac(password, expiry)}`;
}

export function verifySession(token: string | undefined, password: string, now = Date.now()): boolean {
  if (!token) return false;
  const [expiryText, signature, ...rest] = token.split(".");
  const expiry = Number(expiryText);
  if (rest.length || !signature || !Number.isSafeInteger(expiry) || expiry <= now) return false;
  return sameSecret(signature, mac(password, expiry));
}
