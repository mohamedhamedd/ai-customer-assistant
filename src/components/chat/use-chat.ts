"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { readNdjson } from "./ndjson";
import {
  applyEvent,
  isAnsweredElsewhere,
  isBusy,
  newTurn,
  retryTurn,
  sendFailed,
  stopWaiting,
  streamBroke,
  turnsFromHistory,
  type ChatEvent,
  type HistoryMessage,
  type ReplyError,
  type Turn,
} from "./thread";

// Network side of the chat: session id, history, sending, streaming, retry.
// The rules for what each event does to the thread live in thread.ts.

export const OFFLINE = "You're offline. This will send when you're back.";
const UNREACHABLE = "Couldn't reach the assistant. Check your connection and try again.";

// Anonymous visitor id (US-1.1): no sign-up, so the conversation is keyed by
// a random id kept in this browser. One per business, so "New conversation"
// on one chat doesn't reset another.
const sessionKey = (slug: string) => `chat-session:${slug}`;

function uuid(): string {
  // randomUUID needs a secure context (https or localhost).
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Storage can be unavailable (private mode, blocked site data): fall back to
// an id for this page view only.
function loadSessionId(slug: string): string {
  try {
    const stored = localStorage.getItem(sessionKey(slug));
    if (stored) return stored;
  } catch {}
  return storeSessionId(slug, uuid());
}

function storeSessionId(slug: string, id: string): string {
  try {
    localStorage.setItem(sessionKey(slug), id);
  } catch {}
  return id;
}

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

// Polling for an answer that is being produced elsewhere (reload mid-answer,
// another tab). Past the server's 60 s in-progress window, stop and offer a
// retry, which the server then re-runs.
const POLL_MS = 3000;
const GIVE_UP_MS = 65_000;

export type HistoryState = "loading" | "ready" | "failed";

export function useChat(businessSlug: string) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [history, setHistory] = useState<HistoryState>("loading");
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [startedFresh, setStartedFresh] = useState(false);
  // What a screen reader hears: the finished answer or an error, not every
  // streamed fragment.
  const [announcement, setAnnouncement] = useState("");
  const sessionId = useRef<string | null>(null);
  // The latest turns for callbacks. Set eagerly in send(), so a double
  // click can't send twice before React re-renders.
  const turnsRef = useRef(turns);
  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);

  const update = useCallback((key: string, change: (t: Turn) => Turn) => {
    setTurns((ts) => ts.map((t) => (t.key === key ? change(t) : t)));
  }, []);

  // Bumped by every load, send and new conversation. A history response is
  // applied only if nothing happened since it was requested, so a late
  // response can't replace a message the customer just sent.
  const generation = useRef(0);

  const loadHistory = useCallback(async () => {
    const gen = ++generation.current;
    try {
      const url = `/api/chat?business=${encodeURIComponent(businessSlug)}&sessionId=${sessionId.current}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`history ${res.status}`);
      const body = (await res.json()) as { messages: HistoryMessage[] };
      if (gen !== generation.current) return;
      setTurns(turnsFromHistory(body.messages));
      setHistory("ready");
    } catch {
      if (gen === generation.current) setHistory("failed");
    }
  }, [businessSlug]);

  useEffect(() => {
    sessionId.current = loadSessionId(businessSlug);
    void loadHistory();
  }, [businessSlug, loadHistory]);

  const run = useCallback(
    async (turn: Turn) => {
      const key = turn.key;
      const fail = (error: ReplyError) => {
        update(key, (t) => sendFailed(t, error));
        setAnnouncement(`Not sent. ${error.message}`);
      };

      let res: Response;
      try {
        res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ businessSlug, sessionId: sessionId.current, clientMessageId: turn.clientMessageId, message: turn.userText }),
        });
      } catch {
        return fail({ message: navigator.onLine ? UNREACHABLE : OFFLINE, retryable: true });
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        // 409: another message (maybe from another tab) is being answered,
        // so trying again shortly is right. 4xx: the same request would fail
        // the same way.
        return fail({ message: body.error ?? "Something went wrong. Please try again.", retryable: res.status === 409 || res.status >= 500 });
      }

      let finished = false;
      let text = "";
      try {
        await readNdjson(res.body!, (value) => {
          const event = value as ChatEvent;
          if (event.type === "delta") text += event.text;
          if (event.type === "done") setAnnouncement(text);
          if (event.type === "error") setAnnouncement(event.message);
          if (event.type === "done" || event.type === "error") finished = true;
          update(key, (t) => applyEvent(t, event));
        });
      } catch {
        // Network drop mid-stream; handled below.
      }
      if (!finished) {
        update(key, streamBroke);
        setAnnouncement("The connection dropped. You can retry.");
      }
    },
    [businessSlug, update],
  );

  const send = useCallback(
    (text: string) => {
      const message = text.trim();
      // Not before history is loaded: the new message would land before (or
      // be replaced by) the conversation it belongs to.
      if (!message || history !== "ready" || isBusy(turnsRef.current) || !sessionId.current) return false;
      generation.current++;
      // A fresh clientMessageId per message; a retry reuses it.
      const turn = newTurn(uuid(), message);
      turnsRef.current = [...turnsRef.current, turn];
      setTurns((ts) => [...ts, turn]);
      setStartedFresh(false);
      void run(turn);
      return true;
    },
    [history, run],
  );

  const retry = useCallback(() => {
    const last = turnsRef.current.at(-1);
    if (!last?.clientMessageId) return;
    generation.current++;
    const again = retryTurn(last);
    update(last.key, () => again);
    void run(again);
  }, [run, update]);

  const newConversation = useCallback(() => {
    if (isBusy(turnsRef.current)) return;
    generation.current++;
    sessionId.current = storeSessionId(businessSlug, uuid());
    setTurns([]);
    setStartedFresh(true);
    setHistory("ready");
  }, [businessSlug]);

  // An answer being produced elsewhere: refresh history until it lands.
  const answeredElsewhere = isAnsweredElsewhere(turns);
  useEffect(() => {
    if (!answeredElsewhere) return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started < GIVE_UP_MS) return void loadHistory();
      clearInterval(timer);
      generation.current++; // a refresh still in flight must not undo this
      const last = turnsRef.current.at(-1);
      if (last) update(last.key, stopWaiting);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [answeredElsewhere, loadHistory, update]);

  // Send what failed while offline once we're back.
  useEffect(() => {
    const resend = () => {
      const last = turnsRef.current.at(-1);
      if (last?.sendState === "notSent" && last.sendError?.message === OFFLINE) {
        const again = retryTurn(last);
        update(last.key, () => again);
        void run(again);
      }
    };
    window.addEventListener("online", resend);
    return () => window.removeEventListener("online", resend);
  }, [run, update]);

  const reloadHistory = useCallback(() => {
    setHistory("loading");
    void loadHistory();
  }, [loadHistory]);

  // For voice: captions go into the same thread, under the same session.
  const updateTurns = useCallback((change: (ts: Turn[]) => Turn[]) => {
    generation.current++; // a history refresh in flight must not undo this
    setTurns(change);
  }, []);
  const getSessionId = useCallback(() => sessionId.current, []);

  return {
    turns,
    history,
    online,
    startedFresh,
    announcement,
    busy: isBusy(turns),
    send,
    retry,
    newConversation,
    reloadHistory,
    updateTurns,
    getSessionId,
    announce: setAnnouncement,
  };
}
