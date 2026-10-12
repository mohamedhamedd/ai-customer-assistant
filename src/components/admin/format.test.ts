import { test } from "node:test";
import assert from "node:assert/strict";
import { formatInZone, relativeTime } from "./format";

const LA = "America/Los_Angeles";

test("times show in the business timezone, whatever the viewer's", () => {
  // 22:00 UTC is 3 PM in Los Angeles in October (PDT).
  assert.equal(formatInZone("2026-10-20T22:00:00Z", LA), "Tue, Oct 20 · 3:00 PM PDT");
  assert.equal(formatInZone("2026-10-20T22:00:00Z", "America/Toronto"), "Tue, Oct 20 · 6:00 PM EDT");
});

test("each time is labelled for its own date, across the clock change", () => {
  assert.equal(formatInZone("2026-11-10T23:00:00Z", LA), "Tue, Nov 10 · 3:00 PM PST");
});

test("relative times", () => {
  const now = Date.parse("2026-10-20T12:00:00Z");
  assert.equal(relativeTime("2026-10-20T11:59:40Z", now), "just now");
  assert.equal(relativeTime("2026-10-20T11:48:00Z", now), "12 min ago");
  assert.equal(relativeTime("2026-10-20T09:00:00Z", now), "3 h ago");
  assert.equal(relativeTime("2026-10-18T12:00:00Z", now), "2 days ago");
  assert.equal(relativeTime("2026-10-01T12:00:00Z", now), "Oct 1");
});
