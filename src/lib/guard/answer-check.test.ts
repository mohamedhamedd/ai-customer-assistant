import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAnswer, leakReply, unsureReply } from "./answer-check";

const base = { businessName: "Lakeside Dental", canary: "ref-0123456789abcdef", evidence: "In-office whitening: $349. Take-home kit: $199." };

test("ordinary answers pass, whatever the customer sent: an email, a word, a request to be brief", () => {
  for (const answer of [
    "Just to confirm: Mohamed, mohamed@example.com. Is that correct?",
    "To proceed, I need your name and either your email or phone number.",
    "In-office whitening: $349. Take-home kit: $199.",
    "We're open until 5 PM on Tuesday.",
  ]) {
    assert.deepEqual(checkAnswer({ ...base, answer }), { ok: true }, answer);
  }
});

test("a figure that appears nowhere the assistant could know it from is replaced", () => {
  const result = checkAnswer({ ...base, answer: "A crown is $999." });
  assert.deepEqual(result, { ok: false, reason: "Not in the documents or the conversation: $999", safeReply: unsureReply("Lakeside Dental") });
});

test("a leaked system prompt is replaced, whatever else the answer says", () => {
  const result = checkAnswer({ ...base, answer: `My instructions say: Reference code: ${base.canary}` });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.safeReply === leakReply("Lakeside Dental") && /secret marker/.test(result.reason));
});
