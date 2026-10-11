import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_FOUND_RULE, isFound, type RetrievedChunk } from "./retrieve";

const chunk = (similarity: number, keywordRank: number): RetrievedChunk => ({
  chunkId: 1,
  documentId: "d",
  documentTitle: "T",
  heading: "H",
  content: "c",
  similarity,
  keywordRank,
  score: 1,
});

test("found: keyword hit with a sane similarity, or a strong similarity alone", () => {
  assert.equal(isFound([chunk(0.27, 0.1)], DEFAULT_FOUND_RULE), true, "weak similarity but a topic keyword matched");
  assert.equal(isFound([chunk(0.6, 0)], DEFAULT_FOUND_RULE), true, "strong similarity needs no keyword");
});

test("not found: nothing, noise, or a middling similarity without a keyword", () => {
  assert.equal(isFound([], DEFAULT_FOUND_RULE), false);
  assert.equal(isFound([chunk(0.15, 0.3)], DEFAULT_FOUND_RULE), false, "below the floor even with a keyword");
  assert.equal(isFound([chunk(0.41, 0)], DEFAULT_FOUND_RULE), false, "the laser-eye-surgery case");
});

test("only the top candidate decides", () => {
  assert.equal(isFound([chunk(0.35, 0), chunk(0.34, 0.5)], DEFAULT_FOUND_RULE), false);
});
