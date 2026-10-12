import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSessionId, storeSessionId } from "./session";

function fakeStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const store = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
  return { data, store: () => store };
}

const acme = { id: "6f1c2d3e-4b5a-4c7d-8e9f-0a1b2c3d4e5f", slug: "acme-fitness" };

test("the session is kept under the business id, so a new slug finds it", () => {
  const { store } = fakeStore();
  const first = loadSessionId(acme, store);
  assert.equal(loadSessionId({ ...acme, slug: "acme-gym" }, store), first, "same visitor after a rename");
  assert.notEqual(loadSessionId({ id: "another-business", slug: "acme-fitness" }, store), first, "one per business");
});

test("a session stored under the old slug key is moved once, not lost", () => {
  const { data, store } = fakeStore({ "chat-session:acme-fitness": "visitor-1" });
  assert.equal(loadSessionId(acme, store), "visitor-1");
  assert.equal(data.get("chat-session:acme-fitness"), undefined, "the old key is removed");
  assert.equal(data.get(`chat-session:id:${acme.id}`), "visitor-1");
});

test("New conversation replaces it; blocked storage still gives an id", () => {
  const { store } = fakeStore();
  loadSessionId(acme, store);
  storeSessionId(acme, "fresh", store);
  assert.equal(loadSessionId(acme, store), "fresh");
  const blocked = () => {
    throw new Error("SecurityError");
  };
  assert.match(loadSessionId(acme, blocked), /^[0-9a-f-]{36}$/);
});
