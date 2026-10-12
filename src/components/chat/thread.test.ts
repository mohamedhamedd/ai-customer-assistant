import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyEvent,
  canRetry,
  heardPart,
  endVoice,
  voiceAssistantItem,
  voiceCaption,
  voiceCaptionDone,
  voiceUserItem,
  voiceUserTranscript,
  isAnsweredElsewhere,
  isBusy,
  stopWaiting,
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

test("a retryable error drops the partial text (not saved) but keeps actions (they happened)", () => {
  const turn = play(newTurn("c1", "Hi"), [
    { type: "start", userMessageId: 1 },
    { type: "action", action: request },
    { type: "delta", text: "Half an ans" },
    { type: "error", message: "I'm having trouble responding right now.", retryable: true },
  ]);
  assert.equal(turn.reply?.phase, "error");
  assert.equal(turn.reply?.text, "");
  assert.deepEqual(turn.reply?.actions, [request]);
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
    { id: 1, channel: "text", role: "user", content: "q1", sources: [], actions: [], replyFailed: false, clientMessageId: "c1" },
    { id: 2, channel: "text", role: "assistant", content: "a1", sources: [], actions: [request], replyFailed: false, clientMessageId: null },
    { id: 3, channel: "text", role: "user", content: "q2", sources: [], actions: [], replyFailed: true, clientMessageId: "c3" },
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
    { id: 1, channel: "text", role: "user", content: "q", sources: [], actions: [], replyFailed: true, clientMessageId: "c1" },
    { id: 2, channel: "text", role: "assistant", content: "a", sources: [], actions: [], replyFailed: false, clientMessageId: null },
  ]);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].reply?.phase, "done");
  assert.equal(turns[0].reply?.text, "a");
});

test("reloading mid-answer shows the last question as still being answered", () => {
  const turns = turnsFromHistory([
    { id: 1, channel: "text", role: "user", content: "old, abandoned", sources: [], actions: [], replyFailed: false, clientMessageId: "c1" },
    { id: 2, channel: "text", role: "user", content: "q", sources: [], actions: [], replyFailed: false, clientMessageId: "c2" },
  ]);
  assert.equal(turns[0].reply, null, "only the last can be in progress");
  assert.equal(turns[1].reply?.phase, "waiting");
  assert.equal(isAnsweredElsewhere(turns), true);
  assert.equal(isBusy(turns), true, "the composer waits, as the server would answer 409");

  const gaveUp = stopWaiting(turns[1]);
  assert.equal(gaveUp.reply?.error?.message, NOT_ANSWERED);
  assert.equal(canRetry([turns[0], gaveUp], 1), true);
});

test("a message sent from this page isn't treated as answered elsewhere", () => {
  assert.equal(isAnsweredElsewhere([newTurn("c1", "q")]), false);
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

test("voice: the question's caption fills in after the answer has started", () => {
  let turns = voiceUserItem([], "item_q");
  turns = voiceAssistantItem(turns, "item_a", { sources: [], actions: [request] });
  turns = voiceCaption(turns, "item_a", "We're open ");
  turns = voiceCaption(turns, "item_a", "nine to five.");
  turns = voiceUserTranscript(turns, "item_q", " When are you open? ");
  turns = voiceCaptionDone(turns, "item_a", "We're open nine to five.");

  assert.equal(turns.length, 1, "question and answer are one turn");
  assert.equal(turns[0].userText, "When are you open?");
  assert.equal(turns[0].transcribing, false);
  assert.equal(turns[0].reply?.text, "We're open nine to five.");
  assert.equal(turns[0].reply?.phase, "done");
  assert.deepEqual(turns[0].reply?.actions, [request]);
  assert.equal(canRetry(turns, 0), false, "voice turns aren't retried");
});

test("voice: a second answer in a row gets its own turn; repeated events are ignored", () => {
  let turns = voiceUserItem([], "item_q");
  turns = voiceUserItem(turns, "item_q");
  turns = voiceAssistantItem(turns, "item_a1", { sources: [], actions: [] });
  turns = voiceAssistantItem(turns, "item_a1", { sources: [], actions: [] });
  turns = voiceAssistantItem(turns, "item_a2", { sources: [], actions: [] });
  assert.equal(turns.length, 2);
  assert.equal(turns[1].userText, "");
  assert.equal(turns[1].reply?.voiceItemId, "item_a2");
});

test("voice: ending the call settles captions and adds a notice", () => {
  let turns = voiceUserItem([], "item_q");
  turns = voiceAssistantItem(turns, "item_a", { sources: [], actions: [] });
  turns = endVoice(turns, "end-1");
  assert.equal(turns[0].reply?.phase, "done");
  assert.equal(turns[0].transcribing, false);
  assert.equal(turns[1].notice, "Voice session ended");
  assert.equal(isBusy(turns), false, "typing works again");
});

test("history: an unanswered voice question isn't treated as in progress or retryable", () => {
  const turns = turnsFromHistory([{ id: 1, channel: "voice", role: "user", content: "Hello?", sources: [], actions: [], replyFailed: false, clientMessageId: "item_abc" }]);
  assert.equal(turns[0].reply, null);
  assert.equal(turns[0].clientMessageId, null);
  assert.equal(isAnsweredElsewhere(turns), false);
});

test("an interrupted answer keeps roughly what was heard, marked", () => {
  const answer = "In-office whitening is three hundred forty-nine dollars and the take-home kit is one hundred ninety-nine dollars.";
  // 2 s of audio at ~2.7 words/s: the first 6 words.
  assert.equal(heardPart(answer, 2000), "In-office whitening is three hundred forty-nine… (interrupted)");
  assert.equal(heardPart(answer, 0), "(interrupted)", "cut off before any audio played");
  assert.equal(heardPart(answer, 60_000), answer, "the whole answer had played");
});

test("a guard's replacement takes the place of the streamed answer", () => {
  const turn = play(newTurn("c9", "How much is whitening?"), [
    { type: "start", userMessageId: 1 },
    { type: "delta", text: "Whitening is $999." },
    { type: "replace", text: "I don't have that exact information." },
    { type: "sources", sources: [] },
    { type: "done", messageId: 2 },
  ]);
  assert.equal(turn.reply?.text, "I don't have that exact information.");
  assert.equal(turn.reply?.phase, "done");
});
