import { test } from "node:test";
import assert from "node:assert/strict";
import { interleave, summarizeToolCall, type TranscriptItem, type TranscriptMessage, type TranscriptToolCall } from "./transcript";

const t = (s: number) => new Date(Date.UTC(2026, 9, 12, 10, 0, s)).toISOString();

const msg = (id: number, role: "user" | "assistant", s: number, channel: "text" | "voice" = "text"): TranscriptMessage => ({
  kind: "message",
  id,
  role,
  channel,
  content: `${role} ${id}`,
  sources: [],
  createdAt: t(s),
  replyFailed: false,
  replaced: null,
});

const call = (id: number, s: number, messageId: number | null = null): TranscriptToolCall => ({
  kind: "tool",
  id,
  name: "search_knowledge",
  channel: messageId ? "voice" : "text",
  arguments: { query: "hours" },
  result: { ok: true, found: true, results: [] },
  ok: true,
  durationMs: 10,
  createdAt: t(s),
  messageId,
});

const labels = (items: TranscriptItem[]) => items.map((i) => (i.kind === "tool" ? `tool ${i.id}` : `${i.role} ${i.id}`));

test("text: tool calls sit between the question and the answer, by time", () => {
  const items = interleave([msg(2, "assistant", 5), msg(1, "user", 1), msg(3, "user", 10), msg(4, "assistant", 14)], [call(2, 12), call(1, 3)]);
  assert.deepEqual(labels(items), ["user 1", "tool 1", "assistant 2", "user 3", "tool 2", "assistant 4"]);
});

test("voice: a tool call linked to an answer goes right before it, whatever its time", () => {
  // The customer's words were stored after the tool ran (the transcript
  // arrived late): by time alone the tool would come before the question.
  const items = interleave([msg(1, "user", 4, "voice"), msg(2, "assistant", 6, "voice")], [call(1, 2, 2)]);
  assert.deepEqual(labels(items), ["user 1", "tool 1", "assistant 2"]);
});

test("a call linked to a message not shown falls back to time; calls after the last message stay at the end", () => {
  const items = interleave([msg(5, "user", 1)], [call(2, 9), call(1, 3, 999)]);
  assert.deepEqual(labels(items), ["user 5", "tool 1", "tool 2"]);
});

test("search rows: the query and how many matches, or nothing found as a warning", () => {
  assert.deepEqual(summarizeToolCall({ name: "search_knowledge", arguments: { query: "whitening price" }, result: { ok: true, found: true, results: [{}, {}, {}] }, ok: true }), {
    detail: '"whitening price"',
    outcome: "3 matches",
    tone: "neutral",
    failed: false,
  });
  assert.deepEqual(summarizeToolCall({ name: "search_knowledge", arguments: { query: "sedation" }, result: { ok: true, found: false }, ok: true }), {
    detail: '"sedation"',
    outcome: "nothing found",
    tone: "warning",
    failed: false,
  });
});

test("save_lead shows the field names, not the customer's details", () => {
  const s = summarizeToolCall({ name: "save_lead", arguments: { name: "Sara", email: "sara@example.com", phone: null }, result: { ok: true, saved: true }, ok: true });
  assert.deepEqual(s, { detail: "{name, email}", outcome: "saved", tone: "success", failed: false });
});

test("failures: validation says what was wrong, other errors show their code", () => {
  const invalid = summarizeToolCall({
    name: "create_consultation_request",
    arguments: { service: "Whitening" },
    result: { ok: false, error: "invalid_input", message: "preferred_datetime: that time is in the past" },
    ok: false,
  });
  assert.deepEqual(invalid, { detail: "Whitening", outcome: "invalid input: preferred_datetime: that time is in the past", tone: "danger", failed: true });
  const outage = summarizeToolCall({ name: "save_lead", arguments: {}, result: { ok: false, error: "temporarily_unavailable", message: "Tell the customer…" }, ok: false });
  assert.deepEqual(outage, { detail: null, outcome: "temporarily unavailable", tone: "danger", failed: true });
});

test("a write that only proposed its details (confirm before write) is not a failure", () => {
  const s = summarizeToolCall({
    name: "save_lead",
    arguments: { name: "John Doe", phone: "5551234" },
    result: { ok: false, error: "confirm_first", message: "Read the details back…" },
    ok: false,
  });
  assert.deepEqual(s, { detail: "{name, phone}", outcome: "proposed, waiting for a yes", tone: "neutral", failed: false });
});

test("asking which service, or a service that isn't offered, is the conversation working, not a failure", () => {
  const call = (error: string) =>
    summarizeToolCall({ name: "create_consultation_request", arguments: { service: "whitening" }, result: { ok: false, error, message: "…", options: ["In-office whitening"] }, ok: false });
  assert.deepEqual(call("choose_service"), { detail: "whitening", outcome: "asked which service", tone: "neutral", failed: false });
  assert.deepEqual(call("service_not_found"), { detail: "whitening", outcome: "not on the services list", tone: "warning", failed: false });
  assert.deepEqual(call("outside_opening_hours"), { detail: "whitening", outcome: "outside opening hours", tone: "warning", failed: false });
});

test("a changed request shows what it became and from when; a request the team handled is not a failure", () => {
  const changed = summarizeToolCall({
    name: "change_consultation_request",
    arguments: { current_datetime: "2026-10-20T15:00", preferred_datetime: "2026-10-22T10:00" },
    result: { ok: true, service: "Porcelain crown", preferred_time: "Thu, Oct 22 · 10:00 AM", changed_from: { service: "Porcelain crown", preferred_time: "Tue, Oct 20 · 3:00 PM" } },
    ok: true,
  });
  assert.deepEqual(changed, { detail: "Porcelain crown · Thu, Oct 22 · 10:00 AM, was Tue, Oct 20 · 3:00 PM", outcome: "changed", tone: "success", failed: false });
  const handled = summarizeToolCall({ name: "change_consultation_request", arguments: { current_datetime: "2026-10-20T15:00" }, result: { ok: false, error: "request_not_pending", message: "…" }, ok: false });
  assert.deepEqual(handled, { detail: "was 2026-10-20T15:00", outcome: "already handled by the team", tone: "warning", failed: false });
});

test("a cancel and a follow-up show what they were about", () => {
  const cancelled = summarizeToolCall({
    name: "cancel_consultation_request",
    arguments: { current_datetime: "2026-10-14T15:00" },
    result: { ok: true, service: "Invisalign or orthodontic consultation (20 minutes)", preferred_time: "Wed, Oct 14 · 3:00 PM", already_cancelled: false },
    ok: true,
  });
  assert.deepEqual(cancelled, { detail: "Invisalign or orthodontic consultation (20 minutes) · Wed, Oct 14 · 3:00 PM", outcome: "cancelled", tone: "success", failed: false });
  const followUp = summarizeToolCall({ name: "request_follow_up", arguments: { reason: "Call about the confirmed request" }, result: { ok: true, updated: false }, ok: true });
  assert.deepEqual(followUp, { detail: '"Call about the confirmed request"', outcome: "follow-up requested", tone: "success", failed: false });
  const noContact = summarizeToolCall({ name: "request_follow_up", arguments: { reason: "Call me" }, result: { ok: false, error: "lead_required", message: "…" }, ok: false });
  assert.equal(noContact.outcome, "contact not saved yet");
  assert.equal(noContact.failed, false);
});

test("a consultation request shows the service and time, and a repeat says so", () => {
  const s = summarizeToolCall({
    name: "create_consultation_request",
    arguments: { service: "whitening" },
    result: { ok: true, service: "In-office whitening", preferred_time: "Tue, Oct 13 · 3:00 PM PDT", already_requested: true },
    ok: true,
  });
  assert.deepEqual(s, { detail: "In-office whitening · Tue, Oct 13 · 3:00 PM PDT", outcome: "already requested", tone: "success", failed: false });
});
