// The chat thread as plain data, and the rules that change it. No React and
// no fetch here, so every rule is unit-tested (thread.test.ts); the hook in
// use-chat.ts only wires these to the network.
//
// Type-only imports: erased at build, so no server code reaches the browser.
import type { Action } from "@/lib/agent/loop";
import type { ChatEvent } from "@/lib/chat/turn";
import type { Source } from "@/lib/rag/retrieve";

export type { Action, ChatEvent, Source };

export interface ReplyError {
  message: string;
  // True: running the turn again is safe (same clientMessageId; the server
  // replays a stored reply or re-runs a failed one). False: don't offer it.
  retryable: boolean;
}

export interface Reply {
  phase: "waiting" | "streaming" | "done" | "error";
  text: string;
  sources: Source[];
  actions: Action[];
  // The tool running right now, for the status line; null between tools.
  activeTool: string | null;
  error?: ReplyError;
}

export interface Turn {
  key: string;
  // Reused on retry so the server can recognise the same message. Null only
  // for an assistant message with no question before it.
  clientMessageId: string | null;
  userText: string;
  // "notSent": the server never started a turn for it (offline, 409, 4xx).
  sendState: "sending" | "sent" | "notSent";
  sendError?: ReplyError;
  reply: Reply | null;
}

const emptyReply = (): Reply => ({ phase: "waiting", text: "", sources: [], actions: [], activeTool: null });

export function newTurn(clientMessageId: string, userText: string): Turn {
  return { key: clientMessageId, clientMessageId, userText, sendState: "sending", reply: emptyReply() };
}

// A retry starts the reply over: the server replays or re-runs it from the start.
export function retryTurn(turn: Turn): Turn {
  return { ...turn, sendState: "sending", sendError: undefined, reply: emptyReply() };
}

export function applyEvent(turn: Turn, event: ChatEvent): Turn {
  const reply = turn.reply ?? emptyReply();
  switch (event.type) {
    case "start":
      return { ...turn, sendState: "sent" };
    case "delta":
      return { ...turn, reply: { ...reply, phase: "streaming", text: reply.text + event.text } };
    case "tool":
      return { ...turn, reply: { ...reply, activeTool: event.status === "started" ? event.name : null } };
    case "action":
      return { ...turn, reply: { ...reply, actions: [...reply.actions, event.action] } };
    case "sources":
      return { ...turn, reply: { ...reply, sources: event.sources } };
    case "done":
      return { ...turn, reply: { ...reply, phase: "done", activeTool: null } };
    case "error":
      return { ...turn, sendState: "sent", reply: replyError(reply, event) };
  }
}

// A retryable error means nothing was saved: the server stores no partial
// text, so drop it and show the error, and the screen matches a reload. A
// non-retryable one (REPLY_NOT_SAVED) comes after the full answer was shown,
// so the text stays with a note under it.
function replyError(reply: Reply, error: ReplyError): Reply {
  return {
    ...reply,
    phase: "error",
    activeTool: null,
    error: { message: error.message, retryable: error.retryable },
    ...(error.retryable ? { text: "", sources: [], actions: [] } : {}),
  };
}

// The request didn't produce a turn on the server (or we can't tell).
export function sendFailed(turn: Turn, error: ReplyError): Turn {
  return { ...turn, sendState: "notSent", sendError: error, reply: null };
}

// The stream broke after the server started the turn. The reply may still be
// saved there; a retry with the same clientMessageId replays it.
export const CONNECTION_LOST = "The connection dropped before the answer finished.";
export function streamBroke(turn: Turn): Turn {
  return { ...turn, reply: replyError(turn.reply ?? emptyReply(), { message: CONNECTION_LOST, retryable: true }) };
}

// Only the latest turn can be retried: an older one's answer would arrive
// below newer messages, out of order (and the server only runs one turn at a
// time per conversation anyway).
export function canRetry(turns: Turn[], index: number): boolean {
  const turn = turns[index];
  if (index !== turns.length - 1 || !turn.clientMessageId) return false;
  if (turn.sendState === "notSent") return turn.sendError?.retryable ?? false;
  return turn.reply?.phase === "error" && (turn.reply.error?.retryable ?? false);
}

export const isBusy = (turns: Turn[]) => {
  const last = turns.at(-1);
  return !!last && (last.sendState === "sending" || last.reply?.phase === "waiting" || last.reply?.phase === "streaming");
};

// ---------------------------------------------------------------------------
// History (GET /api/chat)
// ---------------------------------------------------------------------------

export interface HistoryMessage {
  id: number;
  role: "user" | "assistant";
  content: string | null;
  sources: unknown;
  actions: unknown;
  replyFailed: boolean;
  clientMessageId: string | null;
}

export const NOT_ANSWERED = "This message wasn't answered. Please try again.";

// Messages come oldest first; a reply directly follows its question.
export function turnsFromHistory(messages: HistoryMessage[]): Turn[] {
  const turns: Turn[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      turns.push({
        key: `m${m.id}`,
        clientMessageId: m.clientMessageId,
        userText: m.content ?? "",
        sendState: "sent",
        // Retryable: the server re-runs a failed message with the same id.
        reply: m.replyFailed ? { ...emptyReply(), phase: "error", error: { message: NOT_ANSWERED, retryable: true } } : null,
      });
      continue;
    }
    const reply: Reply = {
      phase: "done",
      text: m.content ?? "",
      sources: Array.isArray(m.sources) ? (m.sources as Source[]) : [],
      actions: Array.isArray(m.actions) ? (m.actions as Action[]) : [],
      activeTool: null,
    };
    const last = turns.at(-1);
    // An assistant message without a question before it (the page cut it
    // off) gets a turn of its own with no user bubble.
    if (last && last.reply?.phase !== "done") last.reply = reply;
    else turns.push({ key: `m${m.id}`, clientMessageId: null, userText: "", sendState: "sent", reply });
  }
  return turns;
}

// ---------------------------------------------------------------------------
// What to show
// ---------------------------------------------------------------------------

// The model sometimes calls save_lead again with the same details (in the
// same turn or a later one). Each save is real, but repeating the card is
// noise: show one card per turn, and none when the details match the card
// already on screen.
export function visibleActions(turns: Turn[]): Action[][] {
  let lastLead = "";
  return turns.map((turn) => {
    const actions = turn.reply?.actions ?? [];
    const leads = actions.filter((a) => a.kind === "lead_saved");
    const latestLead = leads.at(-1);
    const shown: Action[] = [];
    for (const action of actions) {
      if (action.kind !== "lead_saved") shown.push(action);
      else if (action === latestLead) {
        const key = JSON.stringify(action.details);
        if (key !== lastLead) shown.push(action);
        lastLead = key;
      }
    }
    return shown;
  });
}

// One chip per document section, in retrieval order.
export function uniqueSources(sources: Source[]): Source[] {
  const seen = new Set<string>();
  return sources.filter((s) => {
    const key = `${s.documentId}|${s.heading}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// "sarah@example.com" -> "s***@example.com". Shown on the card, so a shared
// screen doesn't show the whole address.
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 1) return email;
  return `${email[0]}***${email.slice(at)}`;
}

// "+1 416 555 0199" -> "••• 0199"
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length < 4 ? phone : `••• ${digits.slice(-4)}`;
}

export function toolStatus(tool: string, businessName: string): string {
  switch (tool) {
    case "search_knowledge":
      return `Searching ${businessName} information…`;
    case "save_lead":
      return "Saving your details…";
    case "create_consultation_request":
      return "Creating your request…";
    default:
      return "Working on it…";
  }
}

// Same limit as the API (src/app/api/chat/route.ts).
export const MAX_MESSAGE_CHARS = 2000;
export const COUNTER_FROM = 1800;
