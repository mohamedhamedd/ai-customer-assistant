import { test } from "node:test";
import assert from "node:assert/strict";
import { ANSWER_WINDOW_MS, isConfirmed, type ProposalState } from "./confirm";

const at = (s: number) => new Date(Date.UTC(2026, 9, 12, 10, 0, s));
const KEY = '{"email":"sara@example.com"}';
// Proposed, read back, answered.
const answered: ProposalState = { proposal: { key: KEY, at: at(1) }, readBack: { at: at(2), delivered: true }, answerAt: at(5) };

test("a write commits for the proposed details, once the read-back reached the customer and they answered", () => {
  assert.equal(isConfirmed(KEY, answered), true);
});

test("no proposal yet: the first call with new details only proposes", () => {
  assert.equal(isConfirmed(KEY, { ...answered, proposal: null }), false);
});

test("different details than the ones read back are a new proposal", () => {
  assert.equal(isConfirmed('{"email":"sarah@example.com"}', answered), false);
});

test("no read-back reached the customer: the turn failed, or an answer check replaced it", () => {
  assert.equal(isConfirmed(KEY, { ...answered, readBack: null, answerAt: null }), false, "the proposing turn stored no reply");
  assert.equal(isConfirmed(KEY, { ...answered, readBack: { at: at(2), delivered: false } }), false, "replaced before the customer saw it");
});

test("the customer hasn't answered the read-back yet", () => {
  assert.equal(isConfirmed(KEY, { ...answered, answerAt: null }), false);
  assert.equal(isConfirmed(KEY, { ...answered, answerAt: at(2) }), false, "a tie is not an answer");
});

test("an answer long after the read-back is not an answer to it", () => {
  const late = new Date(at(2).getTime() + ANSWER_WINDOW_MS + 1000);
  assert.equal(isConfirmed(KEY, { ...answered, answerAt: late }), false);
  const inTime = new Date(at(2).getTime() + ANSWER_WINDOW_MS - 1000);
  assert.equal(isConfirmed(KEY, { ...answered, answerAt: inTime }), true);
});
