import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyEvent,
  canRetry,
  CONNECTION_LOST,
  maskEmail,
  maskPhone,
  newTurn,
  NOT_ANSWERED,
  retryTurn,
  sendFailed,
  streamBroke,
  turnsFromHistory,
  uniqueSources,
  visibleActions,
  type Action,
  type ChatEvent,
  type Turn,
} from "./thread";

const play = (turn: Turn, events: ChatEvent[]) => events.reduce(applyEvent, turn);

const lead = (email: string): Action => ({ kind: "lead_saved", details: { name: "Sarah", email } });
const request: Action = {
  kind: "consultation_requested",
  requestId: "r1",
  service: "whitening",
  preferredTime: "Tuesday, October 20, 2026 at 3:00 PM PDT",
  status: "pending",
  alreadyRequested: false,
};

test("a streamed reply builds up and finishes", () => {
  const turn = play(newTurn("c1", "Hi"), [
    { type: "start", userMessageId: 1 },
    { type: "tool", name: "search_knowledge", status: "started" },
    { type: "tool", name: "search_knowledge", status: "finished", ok: true },
    { type: "delta", text: "Hello" },
    { type: "delta", text: " there" },
    { type: "sources", sources: [] },
    { type: "done", messageId: 2 },
  ]);
  assert.equal(turn.sendState, "sent");
  assert.equal(turn.reply?.text, "Hello there");
  assert.equal(turn.reply?.phase, "done");
  assert.equal(turn.reply?.activeTool, null);
});

test("the tool status line shows only while a tool runs", () => {
  const running = play(newTurn("c1", "Hi"), [{ type: "tool", name: "search_knowledge", status: "started" }]);
  assert.equal(running.reply?.activeTool, "search_knowledge");
  const finished = applyEvent(running, { type: "tool", name: "search_knowledge", status: "finished", ok: true });
  assert.equal(finished.reply?.activeTool, null);
});

test("a retryable error drops the partial text: the server didn't save it", () => {
  const turn = play(newTurn("c1", "Hi"), [
    { type: "start", userMessageId: 1 },
    { type: "action", action: request },
    { type: "delta", text: "Half an ans" },
    { type: "error", message: "I'm having trouble responding right now.", retryable: true },
  ]);
  assert.equal(turn.reply?.phase, "error");
  assert.equal(turn.reply?.text, "");
  assert.deepEqual(turn.reply?.actions, []);
  assert.equal(turn.reply?.error?.retryable, true);
});

test("a not-saved error keeps the full answer on screen, with the note", () => {
  const turn = play(newTurn("c1", "Hi"), [
    { type: "start", userMessageId: 1 },
    { type: "delta", text: "The whole answer." },
    { type: "error", message: "That answer couldn't be saved.", retryable: false },
  ]);
  assert.equal(turn.reply?.text, "The whole answer.");
  assert.equal(turn.reply?.error?.retryable, false);
});

test("a broken stream is retryable: the server may have saved the reply", () => {
  const turn = streamBroke(play(newTurn("c1", "Hi"), [{ type: "delta", text: "Partial" }]));
  assert.equal(turn.reply?.text, "");
  assert.deepEqual(turn.reply?.error, { message: CONNECTION_LOST, retryable: true });
});

test("only the latest failed turn offers Retry", () => {
  const failed = (id: string) => play(newTurn(id, "q"), [{ type: "error", message: "x", retryable: true }]);
  const turns = [failed("c1"), failed("c2")];
  assert.equal(canRetry(turns, 0), false, "an older answer would land out of order");
  assert.equal(canRetry(turns, 1), true);
});

test("Retry depends on the error, and a retry keeps the clientMessageId", () => {
  const notSaved = play(newTurn("c1", "q"), [{ type: "error", message: "x", retryable: false }]);
  assert.equal(canRetry([notSaved], 0), false);
  const busy = sendFailed(newTurn("c2", "q"), { message: "still answering", retryable: true });
  assert.equal(canRetry([busy], 0), true);
  const invalid = sendFailed(newTurn("c3", "q"), { message: "too long", retryable: false });
  assert.equal(canRetry([invalid], 0), false);

  const again = retryTurn(busy);
  assert.equal(again.clientMessageId, "c2");
  assert.equal(again.sendState, "sending");
  assert.equal(again.reply?.phase, "waiting");
});

test("history pairs each reply with its question, oldest first", () => {
  const turns = turnsFromHistory([
    { id: 1, role: "user", content: "q1", sources: [], actions: [], replyFailed: false, clientMessageId: "c1" },
    { id: 2, role: "assistant", content: "a1", sources: [], actions: [request], replyFailed: false, clientMessageId: null },
    { id: 3, role: "user", content: "q2", sources: [], actions: [], replyFailed: true, clientMessageId: "c3" },
  ]);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].reply?.text, "a1");
  assert.deepEqual(turns[0].reply?.actions, [request]);
  assert.equal(turns[1].reply?.error?.message, NOT_ANSWERED);
  assert.equal(turns[1].clientMessageId, "c3");
  assert.equal(canRetry(turns, 1), true, "a failed last message can be retried after a reload");
});

test("history: a failed message answered by a later re-run shows the answer", () => {
  const turns = turnsFromHistory([
    { id: 1, role: "user", content: "q", sources: [], actions: [], replyFailed: true, clientMessageId: "c1" },
    { id: 2, role: "assistant", content: "a", sources: [], actions: [], replyFailed: false, clientMessageId: null },
  ]);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].reply?.phase, "done");
  assert.equal(turns[0].reply?.text, "a");
});

test("a repeated save_lead shows one card, in the same turn or a later one", () => {
  const withActions = (actions: Action[]): Turn => ({ ...newTurn(crypto.randomUUID(), "q"), reply: { phase: "done", text: "", sources: [], actions, activeTool: null } });
  const shown = visibleActions([
    withActions([lead("s@example.com"), lead("s@example.com"), request]),
    withActions([lead("s@example.com")]),
    withActions([lead("new@example.com")]),
  ]);
  assert.deepEqual(shown[0], [lead("s@example.com"), request]);
  assert.deepEqual(shown[1], [], "same details as the card already shown");
  assert.deepEqual(shown[2], [lead("new@example.com")], "changed details get a card");
});

test("one source chip per document section", () => {
  const s = (documentId: string, heading: string) => ({ documentId, title: "T", heading, excerpt: "", similarity: 0.5 });
  assert.deepEqual(uniqueSources([s("d1", "A"), s("d1", "A"), s("d1", "B"), s("d2", "A")]), [s("d1", "A"), s("d1", "B"), s("d2", "A")]);
});

test("contact details are masked on cards", () => {
  assert.equal(maskEmail("sarah@example.com"), "s***@example.com");
  assert.equal(maskEmail("not-an-email"), "not-an-email");
  assert.equal(maskPhone("+1 (416) 555-0199"), "••• 0199");
});
