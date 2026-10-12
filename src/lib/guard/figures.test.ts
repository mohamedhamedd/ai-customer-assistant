import { test } from "node:test";
import assert from "node:assert/strict";
import { indexEvidence, unsupportedFigures } from "./figures";

const evidence = indexEvidence(
  [
    '{"results":[{"text":"| In-office whitening | $349 |\\n| Take-home kit | $199 |\\nInvisalign: $3,500 to 5,500. Members save 15%."}]}',
    "Monday to Thursday: 8:00 AM to 5:00 PM. Call (503) 555-0142.",
    '{"preferred_datetime":"2026-10-20T15:00"}',
    "My number is 01013514995",
  ].join("\n"),
);
const bad = (answer: string) => unsupportedFigures(answer, evidence).map((f) => `${f.kind}:${f.text}`);

test("figures that appear in the evidence pass, however they are written", () => {
  assert.deepEqual(bad("Whitening is $349 in office, or $199 for the kit."), []);
  assert.deepEqual(bad("Invisalign costs $3,500 to $5,500, and members get 15 % off."), [], "the range end has no $ in the evidence");
  assert.deepEqual(bad("We're open 8 AM to 5 p.m., Monday to Thursday."), []);
  assert.deepEqual(bad("Your request is for Tuesday at 3:00 PM."), [], "from the tool's ISO time");
  assert.deepEqual(bad("Call us at 503-555-0142."), []);
  assert.deepEqual(bad("We'll call you on 01013514995."), [], "the customer's own number");
});

test("an invented price, percentage, time or phone is caught", () => {
  assert.deepEqual(bad("Whitening is $299."), ["money:$299"]);
  assert.deepEqual(bad("Members save 20%."), ["percent:20%"]);
  assert.deepEqual(bad("We close at 6 PM."), ["time:6 PM"]);
  assert.deepEqual(bad("Call (503) 555-0199."), ["phone:(503) 555-0199"]);
});

test("counts and list numbers are not checked", () => {
  assert.deepEqual(bad("1. Two cleanings a year\n2. One set of X-rays\nIt takes 60 to 90 minutes."), []);
});
