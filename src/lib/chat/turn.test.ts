import { test } from "node:test";
import assert from "node:assert/strict";
import { decideRetry, fitHistory, HISTORY_CHARS, IN_PROGRESS_WINDOW_MS, replayEvents } from "./turn";

const now = new Date("2026-10-11T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const reply = { id: 7, content: "We're open until 5.", sources: [], actions: [] };

test("retry with a stored reply replays it, however old", () => {
  assert.deepEqual(decideRetry({ reply_attempt_at: ago(1_000), reply_failed_at: null }, reply, now), { kind: "replay", reply });
  assert.deepEqual(decideRetry({ reply_attempt_at: ago(3_600_000), reply_failed_at: null }, reply, now), { kind: "replay", reply });
});

test("retry with no reply inside the window is 'in progress' (the original is probably still running)", () => {
  assert.deepEqual(decideRetry({ reply_attempt_at: ago(5_000), reply_failed_at: null }, null, now), { kind: "in_progress" });
  assert.deepEqual(decideRetry({ reply_attempt_at: ago(IN_PROGRESS_WINDOW_MS - 1), reply_failed_at: null }, null, now), { kind: "in_progress" });
});

test("retry with no reply after the window re-runs (the original died); the window counts from the latest attempt", () => {
  assert.deepEqual(decideRetry({ reply_attempt_at: ago(IN_PROGRESS_WINDOW_MS), reply_failed_at: null }, null, now), { kind: "rerun" });
});

test("retry after a recorded failure re-runs immediately, even inside the window", () => {
  assert.deepEqual(decideRetry({ reply_attempt_at: ago(2_000), reply_failed_at: ago(1_000) }, null, now), { kind: "rerun" });
});

test("a replay emits the same event shape as a live turn", () => {
  const action = { kind: "lead_saved", details: { name: "Sara" } };
  const events = replayEvents(3, { ...reply, sources: [{ documentId: "d" }], actions: [action] });
  assert.deepEqual(events.map((e) => e.type), ["start", "action", "delta", "sources", "done"]);
  assert.deepEqual(events.at(-1), { type: "done", messageId: 7, replayed: true });
});

test("history: the newest messages that fit the size budget, oldest first; the newest always goes", () => {
  const m = (content: string) => ({ role: "user" as const, content });
  // Seen live: ~35 short voice fragments while spelling a phone number pushed
  // the agreed request out of a 20-message window.
  const fragments = Array.from({ length: 35 }, (_, i) => m(`Fragment ${i}`));
  const agreed = m("Just to confirm: In-office teeth whitening (single session) on Wednesday, October 14, 2026 at 3:00 PM. Is that right?");
  const newestFirst = [...fragments].reverse().concat([agreed]);
  const kept = fitHistory(newestFirst);
  assert.equal(kept[0], agreed, "the agreed request is still there, first");
  assert.equal(kept.at(-1), fragments[34]);

  const long = Array.from({ length: 5 }, (_, i) => m(`${i}`.repeat(3_000)));
  assert.deepEqual(fitHistory(long).map((x) => x.content[0]), ["1", "0"], "the newest that fit, in order");
  assert.equal(fitHistory([m("x".repeat(HISTORY_CHARS * 2))]).length, 1, "the newest always goes");
});
