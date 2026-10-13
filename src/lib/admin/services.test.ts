import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanSuggestions } from "./services";

const DOCUMENTS = `## Orthodontics
| Service | Price |
|---|---|
| Invisalign (full treatment) | $3,500 to $5,500 |
| Traditional braces (full treatment) | $4,000 to $6,000 |
## Sessions
Personal   training session: one hour with a coach.`;

test("only names written in the documents are kept, in the documents' spelling", () => {
  assert.deepEqual(
    cleanSuggestions(["Traditional braces (full treatment)", "Invisalign (full treatment)", "Personal training session"], DOCUMENTS),
    ["Traditional braces (full treatment)", "Invisalign (full treatment)", "Personal training session"],
    "spacing in the documents doesn't matter",
  );
  // Invented or reworded by the model: dropped. Words that are in the documents stay (staff review the list).
  assert.deepEqual(cleanSuggestions(["Teeth cleaning", "Laser hair removal", "Braces (full)", "Traditional braces"], DOCUMENTS), ["Traditional braces"]);
});

test("a name contained in a longer one is dropped: a services page and a price list naming the same thing", () => {
  assert.deepEqual(
    cleanSuggestions(["Traditional braces", "Invisalign (full treatment)", "Traditional braces (full treatment)", "Invisalign", "Personal training session"], DOCUMENTS + "\nTraditional braces\nInvisalign"),
    ["Invisalign (full treatment)", "Traditional braces (full treatment)", "Personal training session"],
  );
});

test("repeats, blanks, very short or long names and non-strings are dropped; at most 50", () => {
  assert.deepEqual(cleanSuggestions(["Invisalign (full treatment)", "invisalign  (FULL treatment)", "", "  ", 42, null], DOCUMENTS), ["Invisalign (full treatment)"]);
  assert.deepEqual(cleanSuggestions("not a list", DOCUMENTS), []);
  const many = Array.from({ length: 60 }, (_, i) => `Service number ${i}`);
  assert.equal(cleanSuggestions(many, many.join("\n")).length, 50);
  assert.deepEqual(cleanSuggestions(["x".repeat(121)], "x".repeat(121)), []);
});
