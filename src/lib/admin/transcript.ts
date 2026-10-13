import type { Json } from "@/lib/db/database.types";
import type { Channel } from "@/lib/db/enums";
import type { Source } from "@/lib/rag/retrieve";

// A conversation as the admin reads it (US-9.1, 9.2): the messages, with
// every tool call the assistant made shown where it happened. Pure, so the
// ordering rule is unit-tested; the page and the server both use these types.

export interface TranscriptMessage {
  kind: "message";
  id: number;
  role: "user" | "assistant";
  channel: Channel;
  // null: a voice item that transcribed to nothing (a cough, silence).
  content: string | null;
  sources: Source[];
  createdAt: string;
  // A customer message the assistant never answered (the turn failed).
  replyFailed: boolean;
  // An answer the answer check replaced: what the model wrote, and why.
  // Staff only; the customer saw the safe reply in content.
  replaced: { original: string; reason: string } | null;
}

export interface TranscriptToolCall {
  kind: "tool";
  id: number;
  name: string;
  channel: Channel;
  arguments: Json;
  result: Json;
  ok: boolean;
  durationMs: number;
  createdAt: string;
  // The voice answer that used it (set when the answer is stored).
  messageId: number | null;
}

export type TranscriptItem = TranscriptMessage | TranscriptToolCall;

// Where each tool call goes:
// - linked to an answer (voice): right before that answer. The link is
//   exact; times aren't, because the customer's spoken words are stored
//   when their transcript arrives, which can be after the tool ran.
// - otherwise (text): by time, before the first message stored after it.
//   A text turn stores the question, runs its tools, then stores the
//   answer, so time order is the real order.
export function interleave(messages: TranscriptMessage[], calls: TranscriptToolCall[]): TranscriptItem[] {
  const at = (iso: string) => new Date(iso).getTime();
  const ordered = [...messages].sort((a, b) => a.id - b.id);
  const shown = new Set(ordered.map((m) => m.id));
  const byAnswer = new Map<number, TranscriptToolCall[]>();
  const timed: TranscriptToolCall[] = [];
  for (const call of [...calls].sort((a, b) => a.id - b.id)) {
    if (call.messageId !== null && shown.has(call.messageId)) {
      byAnswer.set(call.messageId, [...(byAnswer.get(call.messageId) ?? []), call]);
    } else {
      timed.push(call);
    }
  }
  timed.sort((a, b) => at(a.createdAt) - at(b.createdAt) || a.id - b.id);

  const items: TranscriptItem[] = [];
  let next = 0;
  for (const message of ordered) {
    while (next < timed.length && at(timed[next].createdAt) < at(message.createdAt)) items.push(timed[next++]);
    items.push(...(byAnswer.get(message.id) ?? []), message);
  }
  items.push(...timed.slice(next));
  return items;
}

export type Tone = "success" | "warning" | "danger" | "neutral";

export interface ToolSummary {
  // What it was asked: the search query, the fields saved, the service.
  detail: string | null;
  // How it went, in a few words.
  outcome: string;
  tone: Tone;
  // Something went wrong (shown red and open). Not the same as ok: false: a
  // write that only proposed its details is the confirm step doing its job.
  failed: boolean;
}

const record = (value: Json): Record<string, Json | undefined> => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const text = (value: Json | undefined) => (typeof value === "string" && value.trim() ? value : null);
// A request's services: the list the model sent ("a, b"), or one service (before lists).
const services = (args: Record<string, Json | undefined>) => {
  const list = Array.isArray(args.services) ? args.services.filter((s): s is string => typeof s === "string" && s.trim() !== "") : [];
  return list.length ? list.join(", ") : text(args.service);
};

// One line per tool call, e.g. `"whitening price" · 3 matches`. The full
// arguments and result are one click away; this line is for scanning.
export function summarizeToolCall(call: Pick<TranscriptToolCall, "name" | "arguments" | "result" | "ok">): ToolSummary {
  const args = record(call.arguments);
  const result = record(call.result);

  let detail: string | null = null;
  if (call.name === "search_knowledge") {
    const query = text(args.query);
    detail = query && `"${query}"`;
  } else if (call.name === "save_lead") {
    // The field names, not the values: the values are a click away.
    const fields = Object.keys(args).filter((k) => text(args[k]));
    detail = fields.length ? `{${fields.join(", ")}}` : null;
  } else if (call.name === "create_consultation_request") {
    detail = [text(result.service) ?? services(args), text(result.preferred_time)].filter(Boolean).join(" · ") || null;
  } else if (call.name === "change_consultation_request") {
    // What it becomes, and from when.
    const now = [text(result.service) ?? services(args), text(result.preferred_time) ?? text(args.preferred_datetime)].filter(Boolean).join(" · ");
    const was = text(record(result.changed_from ?? null).preferred_time) ?? text(args.current_datetime);
    detail = [now, was && `was ${was}`].filter(Boolean).join(", ") || null;
  } else if (call.name === "cancel_consultation_request") {
    detail = [text(result.service), text(result.preferred_time) ?? text(args.current_datetime)].filter(Boolean).join(" · ") || null;
  } else if (call.name === "request_follow_up") {
    const reason = text(args.reason);
    detail = reason && `"${reason}"`;
  }

  // Confirm before write (src/lib/agent/confirm.ts): a first call only
  // proposes the details; the model reads them back before they're saved.
  if (!call.ok && result.error === "confirm_first") return { detail, outcome: "proposed, waiting for a yes", tone: "neutral", failed: false };
  // The service, from the services table (src/lib/agent/service-choice.ts):
  // the customer is asked to choose, or told it isn't offered.
  if (!call.ok && result.error === "choose_service") return { detail, outcome: "asked which service", tone: "neutral", failed: false };
  if (!call.ok && result.error === "service_not_found") return { detail, outcome: "not on the services list", tone: "warning", failed: false };
  // A time the business is closed (Admin > Opening hours): another time is suggested.
  if (!call.ok && result.error === "outside_opening_hours") return { detail, outcome: "outside opening hours", tone: "warning", failed: false };
  // A change to a request the team already handled, or to none, or to the same.
  if (!call.ok && result.error === "request_not_pending") return { detail, outcome: "already handled by the team", tone: "warning", failed: false };
  if (!call.ok && result.error === "request_not_found") return { detail, outcome: "no such request", tone: "warning", failed: false };
  if (!call.ok && result.error === "check_date") return { detail, outcome: "date corrected (this/next week)", tone: "neutral", failed: false };
  if (!call.ok && result.error === "slot_taken") return { detail, outcome: "another request at that time", tone: "warning", failed: false };
  if (!call.ok && result.error === "no_change") return { detail, outcome: "nothing to change", tone: "neutral", failed: false };
  if (!call.ok && result.error === "lead_required") return { detail, outcome: "contact not saved yet", tone: "warning", failed: false };
  if (!call.ok) {
    const error = text(result.error) ?? "failed";
    // Validation messages are short and say what was wrong; the others are
    // instructions for the model, so the code says enough here.
    const outcome = error === "invalid_input" && text(result.message) ? `invalid input: ${result.message}` : error.replace(/_/g, " ");
    return { detail, outcome, tone: "danger", failed: true };
  }
  if (call.name === "search_knowledge") {
    if (result.found === false) return { detail, outcome: "nothing found", tone: "warning", failed: false };
    const n = Array.isArray(result.results) ? result.results.length : 0;
    return { detail, outcome: `${n} ${n === 1 ? "match" : "matches"}`, tone: "neutral", failed: false };
  }
  if (call.name === "save_lead") return { detail, outcome: "saved", tone: "success", failed: false };
  if (call.name === "create_consultation_request") {
    return { detail, outcome: result.already_requested === true ? "already requested" : "requested", tone: "success", failed: false };
  }
  if (call.name === "change_consultation_request") {
    return { detail, outcome: result.already_changed === true ? "already changed" : "changed", tone: "success", failed: false };
  }
  if (call.name === "cancel_consultation_request") {
    return { detail, outcome: result.already_cancelled === true ? "already cancelled" : "cancelled", tone: "success", failed: false };
  }
  if (call.name === "request_follow_up") return { detail, outcome: result.updated === true ? "follow-up updated" : "follow-up requested", tone: "success", failed: false };
  return { detail, outcome: "done", tone: "success", failed: false };
}
