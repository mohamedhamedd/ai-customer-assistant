import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanSuggestedRows } from "./services";

const DOCUMENTS = `## Orthodontics
| Service | Price |
|---|---|
| Invisalign (full treatment) | $3,500 to $5,500 |
| Traditional braces (full treatment) | $4,000 to $6,000 |
## Sessions
Personal   training session: 60 minutes, $60.`;

const row = (over: Record<string, unknown>) => ({ name: "", category: "", price: "", duration: "", requestable: true, ...over });

test("names, prices and durations are kept only as the documents write them", () => {
  assert.deepEqual(
    cleanSuggestedRows(
      [
        row({ name: "Traditional braces (full treatment)", category: "Orthodontics", price: "$4,000 to $6,000" }),
        row({ name: "Personal training session", category: "Sessions", price: "$60", duration: "60 minutes" }),
      ],
      DOCUMENTS,
    ),
    [
      { name: "Traditional braces (full treatment)", category: "Orthodontics", price: "$4,000 to $6,000", duration: "", description: "", requestable: true },
      { name: "Personal training session", category: "Sessions", price: "$60", duration: "60 minutes", description: "", requestable: true },
    ],
  );
});

test("anything the model made up is dropped or left blank", () => {
  assert.deepEqual(
    cleanSuggestedRows(
      [
        row({ name: "Laser hair removal", price: "$200" }),
        row({ name: "Invisalign (full treatment)", category: "Cosmetic", price: "$3,999", duration: "90 minutes", requestable: false }),
      ],
      DOCUMENTS,
    ),
    [{ name: "Invisalign (full treatment)", category: "", price: "", duration: "", description: "", requestable: false }],
    "an invented service is dropped; an invented price, duration or category is blanked",
  );
});

test("one row per service: repeats and names contained in a longer one are dropped", () => {
  const names = cleanSuggestedRows(
    [row({ name: "Traditional braces" }), row({ name: "Traditional braces (full treatment)" }), row({ name: "traditional  BRACES (full treatment)" })],
    DOCUMENTS + "\nTraditional braces",
  ).map((r) => r.name);
  assert.deepEqual(names, ["Traditional braces (full treatment)"]);
  assert.deepEqual(cleanSuggestedRows("not a list", DOCUMENTS), []);
});
