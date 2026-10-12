import { test } from "node:test";
import assert from "node:assert/strict";
import { isConfirmed } from "./confirm";

const at = (s: number) => new Date(Date.UTC(2026, 9, 12, 10, 0, s));
const KEY = '{"email":"sara@example.com"}';

test("a write commits only for the proposed details, after the customer has spoken since", () => {
  assert.equal(isConfirmed(KEY, { proposal: { key: KEY, at: at(1) }, customerSpokeAt: at(5) }), true);
});

test("no proposal yet: the first call with new details only proposes", () => {
  assert.equal(isConfirmed(KEY, { proposal: null, customerSpokeAt: at(5) }), false);
});

test("the same reply that proposed can't commit: the customer hasn't answered", () => {
  assert.equal(isConfirmed(KEY, { proposal: { key: KEY, at: at(5) }, customerSpokeAt: at(1) }), false);
  assert.equal(isConfirmed(KEY, { proposal: { key: KEY, at: at(5) }, customerSpokeAt: at(5) }), false, "a tie is not an answer");
  assert.equal(isConfirmed(KEY, { proposal: { key: KEY, at: at(1) }, customerSpokeAt: null }), false);
});

test("different details than the ones read back are a new proposal", () => {
  assert.equal(isConfirmed('{"email":"sarah@example.com"}', { proposal: { key: KEY, at: at(1) }, customerSpokeAt: at(5) }), false);
});
