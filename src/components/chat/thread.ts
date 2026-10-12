// The chat thread as plain data, and the rules that change it. No React and
// no fetch here, so every rule is unit-tested (thread.test.ts); the hook in
// use-chat.ts only wires these to the network.
//
// Type-only imports: erased at build, so no server code reaches the browser.
import type { Action } from "@/lib/agent/loop";
import type { ChatEvent } from "@/lib/chat/turn";
import type { Source } from "@/lib/rag/retrieve";

export type { Action, ChatEvent, Source };
export { MAX_MESSAGE_CHARS } from "@/lib/chat/limits";

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
  // Voice: the Realtime item this caption belongs to.
  voiceItemId?: string;
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
  // Loaded from history rather than sent from this page. A restored turn
  // that is "waiting" is being answered elsewhere (the page was reloaded
  // mid-answer, or another tab): the hook polls history until it lands.
  restored?: boolean;
  channel?: "text" | "voice";
  // Voice: the customer's speech is still being transcribed.
  transcribing?: boolean;
  // A centred system line ("Voice session ended") instead of a message.
  notice?: string;
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
    // A guard rejected the streamed answer: the replacement is what stays
    // (and what a reload shows).
    case "replace":
      return { ...turn, reply: { ...reply, text: event.text } };
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

// A retryable error means the reply wasn't saved: the server stores no
// partial text, so drop it (and its sources) and show the error. Actions stay:
// a lead or request saved before the failure really exists, and hiding it
// would invite the customer to give their details again. A non-retryable
// error (REPLY_NOT_SAVED) comes after the full answer was shown, so the text
// stays with a note under it.
function replyError(reply: Reply, error: ReplyError): Reply {
  return {
    ...reply,
    phase: "error",
    activeTool: null,
    error: { message: error.message, retryable: error.retryable },
    ...(error.retryable ? { text: "", sources: [] } : {}),
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
  channel: "text" | "voice";
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
      const text = m.channel === "text";
      turns.push({
        key: `m${m.id}`,
        // A voice row's id is a Realtime item id: nothing to retry with.
        clientMessageId: text ? m.clientMessageId : null,
        userText: m.content ?? "",
        sendState: "sent",
        // Retryable: the server re-runs a failed message with the same id.
        reply: text && m.replyFailed ? { ...emptyReply(), phase: "error", error: { message: NOT_ANSWERED, retryable: true } } : null,
        restored: true,
        channel: m.channel,
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
    else turns.push({ key: `m${m.id}`, clientMessageId: null, userText: "", sendState: "sent", reply, restored: true, channel: m.channel });
  }
  // The last text question with no reply and no failure is still being
  // answered (one turn at a time, so only the last can be). Older unanswered
  // ones were abandoned, and an unanswered voice question ended with its call.
  const last = turns.at(-1);
  if (last && last.channel === "text" && last.userText && !last.reply) last.reply = emptyReply();
  return turns;
}

// Waiting on an answer from elsewhere for too long: the server's in-progress
// window has passed, so a retry with the same id re-runs it.
export function stopWaiting(turn: Turn): Turn {
  if (turn.reply?.phase !== "waiting") return turn;
  return { ...turn, reply: { ...emptyReply(), phase: "error", error: { message: NOT_ANSWERED, retryable: true } } };
}

// ---------------------------------------------------------------------------
// Voice (Realtime items). Captions live in the same thread as text.
// ---------------------------------------------------------------------------

const voiceKey = (itemId: string) => `v:${itemId}`;

// The customer started speaking: a turn whose text arrives when it's transcribed.
export function voiceUserItem(turns: Turn[], itemId: string): Turn[] {
  if (turns.some((t) => t.key === voiceKey(itemId))) return turns;
  return [...turns, { key: voiceKey(itemId), clientMessageId: null, userText: "", sendState: "sent", reply: null, channel: "voice", transcribing: true }];
}

export function voiceUserTranscript(turns: Turn[], itemId: string, transcript: string): Turn[] {
  return turns.map((t) => (t.key === voiceKey(itemId) ? { ...t, userText: transcript.trim(), transcribing: false } : t));
}

// The assistant started answering. Citations and cards from the tools it
// just ran are attached here, as the server does for the stored copy.
export function voiceAssistantItem(turns: Turn[], itemId: string, extras: { sources: Source[]; actions: Action[] }): Turn[] {
  if (turns.some((t) => t.reply?.voiceItemId === itemId)) return turns;
  const reply: Reply = { ...emptyReply(), phase: "streaming", sources: extras.sources, actions: extras.actions, voiceItemId: itemId };
  const last = turns.at(-1);
  if (last && last.channel === "voice" && !last.reply && !last.notice) return [...turns.slice(0, -1), { ...last, reply }];
  // A second answer in a row (or an opening line): its own turn, no question.
  return [...turns, { key: `${voiceKey(itemId)}:a`, clientMessageId: null, userText: "", sendState: "sent", reply, channel: "voice" }];
}

function updateVoiceReply(turns: Turn[], itemId: string, change: (r: Reply) => Reply): Turn[] {
  return turns.map((t) => (t.reply?.voiceItemId === itemId ? { ...t, reply: change(t.reply) } : t));
}

export const voiceCaption = (turns: Turn[], itemId: string, delta: string) => updateVoiceReply(turns, itemId, (r) => ({ ...r, text: r.text + delta }));

export const voiceCaptionDone = (turns: Turn[], itemId: string, transcript: string) =>
  updateVoiceReply(turns, itemId, (r) => ({ ...r, text: transcript || r.text, phase: "done" }));

// The customer talked over the assistant. The caption text runs ahead of
// the audio, so the full transcript includes words they never heard (and
// OpenAI drops the text of a truncated answer from its own context). Keep
// roughly what was heard, from how much audio played (audio_end_ms) at a
// typical speaking rate, and say it was interrupted: that is what the screen
// shows and what later turns, text or voice, see.
export const SPOKEN_WORDS_PER_SECOND = 2.7; // about 160 words a minute
export const INTERRUPTED = "(interrupted)";

export function heardPart(text: string, audioEndMs: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const heard = Math.ceil((Math.max(0, audioEndMs) / 1000) * SPOKEN_WORDS_PER_SECOND);
  if (heard >= words.length) return text.trim();
  if (heard === 0) return INTERRUPTED;
  return `${words.slice(0, heard).join(" ")}… ${INTERRUPTED}`;
}

// The call ended: nothing is streaming any more, and a line marks the end.
export function endVoice(turns: Turn[], noticeKey: string, notice = "Voice session ended"): Turn[] {
  const settled = turns.map((t) => {
    if (t.channel !== "voice") return t;
    const reply = t.reply && t.reply.phase === "streaming" ? { ...t.reply, phase: "done" as const } : t.reply;
    return { ...t, reply, transcribing: false };
  });
  return [...settled, { key: noticeKey, clientMessageId: null, userText: "", sendState: "sent", reply: null, notice }];
}

export const isAnsweredElsewhere = (turns: Turn[]) => {
  const last = turns.at(-1);
  return !!last?.restored && last.reply?.phase === "waiting";
};

// ---------------------------------------------------------------------------
// What to show
// ---------------------------------------------------------------------------

// The server already drops a repeated save within one turn (loop.ts). Across
// turns, the model sometimes saves the same details again: each save is real
// and stored, but a second identical card is noise, so a "details saved" card
// is only shown when the details differ from the last one shown.
export function visibleActions(turns: Turn[]): Action[][] {
  let lastLead = "";
  return turns.map((turn) =>
    (turn.reply?.actions ?? []).filter((action) => {
      if (action.kind !== "lead_saved") return true;
      const key = JSON.stringify(action.details);
      if (key === lastLead) return false;
      lastLead = key;
      return true;
    }),
  );
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

export const COUNTER_FROM = 1800;
