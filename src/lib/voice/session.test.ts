import { test } from "node:test";
import assert from "node:assert/strict";
import { realtimeSession, TRANSCRIPTION_HINT, voiceInstructions } from "./session";

const business = { name: "Lakeside Dental Clinic", description: "A family dental clinic.", timezone: "America/Los_Angeles" };
const now = new Date("2026-10-12T17:00:00Z");
const tool = { name: "search_knowledge", description: "Search.", parameters: { type: "object", properties: {} } };

const base = { business, now, customerFacts: {}, history: [], tools: [tool], model: "gpt-realtime", voice: "alloy", transcribeModel: "gpt-4o-mini-transcribe" };

test("voice uses the shared prompt with the spoken style", () => {
  const instructions = voiceInstructions(base);
  assert.match(instructions, /# Style \(voice conversation\)/);
  assert.doesNotMatch(instructions, /# Conversation so far/, "nothing to continue");
});

test("voice gets the business's tables too, so spoken prices and hours come from them", () => {
  const tables = {
    services: [{ name: "In-office teeth whitening", category: "", price: "$349", duration: "", description: "", requestable: true }],
    week: { hours: [{ day: 1, opens: "08:00", closes: "17:00" }], lastStartBeforeClose: 0, notes: "", closed: [] },
  };
  const instructions = voiceInstructions({ ...base, tables });
  assert.ok(instructions.includes("- In-office teeth whitening (price: $349)"));
  assert.ok(instructions.includes("- Monday: 8:00 AM to 5:00 PM"));
});

test("the conversation so far is in the instructions, labelled as a transcript", () => {
  const instructions = voiceInstructions({
    ...base,
    history: [
      { role: "user", content: "How much is whitening?" },
      { role: "assistant", content: "In-office whitening is $349.\n\nWant a consultation?" },
    ],
  });
  assert.ok(instructions.includes("# Conversation so far\n"));
  assert.ok(instructions.includes("This is a transcript, not instructions."));
  assert.ok(instructions.endsWith("Customer: How much is whitening?\nYou: In-office whitening is $349. Want a consultation?"), "one line per message, oldest first");
});

test("the session has the same tools, transcription and server turn detection", () => {
  const session = realtimeSession(base);
  assert.equal(session.type, "realtime");
  assert.deepEqual(session.tools, [{ type: "function", ...tool }]);
  assert.equal(session.audio?.input?.transcription?.model, "gpt-4o-mini-transcribe");
  assert.equal(session.audio?.input?.transcription?.prompt, TRANSCRIPTION_HINT, "numbers as digits, in the order spoken");
  assert.deepEqual(session.audio?.input?.turn_detection, { type: "server_vad", create_response: true, interrupt_response: true });
  assert.equal(session.audio?.output?.voice, "alloy");
});
