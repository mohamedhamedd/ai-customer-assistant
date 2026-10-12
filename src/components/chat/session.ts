// The visitor's session id in this browser. No React, so it is unit-tested.

// Anonymous visitor id (US-1.1): no sign-up, so the conversation is keyed by
// a random id kept in this browser. One per business, so "New conversation"
// on one chat doesn't reset another. Stored under the business's id, which
// never changes: under its slug, a rename would lose every returning
// customer's conversation.
// Its own prefix: a slug can't be mistaken for an id key.
const sessionKey = (businessId: string) => `chat-session:id:${businessId}`;
// Where sessions were stored before (by slug), read once and moved.
const legacySessionKey = (slug: string) => `chat-session:${slug}`;

export function uuid(): string {
  // randomUUID needs a secure context (https or localhost).
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
// localStorage itself can throw on access (blocked site data).
const browserStore = (): Store => localStorage;

// Storage can be unavailable (private mode, blocked site data): fall back to
// an id for this page view only.
export function loadSessionId(business: SessionScope, store: () => Store = browserStore): string {
  try {
    const s = store();
    const stored = s.getItem(sessionKey(business.id));
    if (stored) return stored;
    const legacy = s.getItem(legacySessionKey(business.slug));
    if (legacy) {
      s.removeItem(legacySessionKey(business.slug));
      return storeSessionId(business, legacy, store);
    }
  } catch {}
  return storeSessionId(business, uuid(), store);
}

export function storeSessionId(business: SessionScope, id: string, store: () => Store = browserStore): string {
  try {
    store().setItem(sessionKey(business.id), id);
  } catch {}
  return id;
}

export interface SessionScope {
  id: string;
  slug: string;
}
