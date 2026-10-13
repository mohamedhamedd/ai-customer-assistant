import { test } from "node:test";
import assert from "node:assert/strict";
import { isPlainYes } from "./affirm";

test("a plain yes, in its usual forms", () => {
  for (const m of ["yes", "Yes.", "YEAH", "yeah!", "yep", "ok", "Okay", "correct", "That's right", "that’s correct", "yes, please", "Yes, that's right!", "👍", "  sure  "]) {
    assert.equal(isPlainYes(m), true, m);
  }
});

test("anything more, or less, goes to the model", () => {
  for (const m of ["no", "yes but make it 4 pm", "yes and also book a cleaning", "not right", "yeah, 01013514992", "can you update the phone number?", "", "maybe"]) {
    assert.equal(isPlainYes(m), false, m);
  }
});
