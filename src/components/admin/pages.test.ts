import { test } from "node:test";
import assert from "node:assert/strict";
import { pageNumbers } from "./pages";

test("page links: the first, the last, and the pages around the current one, with gaps", () => {
  assert.deepEqual(pageNumbers(1, 1), [1]);
  assert.deepEqual(pageNumbers(1, 3), [1, 2, 3]);
  assert.deepEqual(pageNumbers(1, 12), [1, 2, "gap", 12]);
  assert.deepEqual(pageNumbers(5, 12), [1, "gap", 4, 5, 6, "gap", 12]);
  assert.deepEqual(pageNumbers(3, 12), [1, 2, 3, 4, "gap", 12], "no gap between 1 and 2");
  assert.deepEqual(pageNumbers(12, 12), [1, "gap", 11, 12]);
});
