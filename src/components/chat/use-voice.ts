"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  endVoice,
  heardPart,
  INTERRUPTED,
  voiceAssistantItem,
  voiceCaption,
  voiceCaptionDone,
  voiceUserItem,
  voiceUserTranscript,
  type Action,
  type Source,
  type Turn,
} from "./thread";

// Voice mode over the OpenAI Realtime API (US-2.x, design D-07).
//
// Audio flows browser <-> OpenAI over WebRTC. Our server opens the call
// (/api/voice/session, so no OpenAI key or token reaches the browser) and
// returns a secret for this call; with it, the browser relays the tools the
// model calls (/api/voice/tool) and reports transcripts (/api/voice/items).
// Events arrive on the "oai-events" data channel.

// A "disconnected" connection often recovers by itself (a network switch);
// only end the call if it stays down this long, or "failed" outright.
const DISCONNECT_GRACE_MS = 5000;

// How long a tool call waits for the customer's last words to be transcribed
// (see heard below). Short answers ("yes") usually take well under a second.
const TRANSCRIPT_WAIT_MS = 3000;

export type VoiceState =
  | "off"
  | "explain" // pre-permission explainer
  | "connecting"
  | "listening"
  | "hearing" // the customer is speaking
  | "thinking"
  | "checking" // running a tool
  | "speaking"
  | "denied" // microphone permission refused
  | "failed"; // couldn't start, or the connection dropped

export const voiceSupported = () =>
  typeof window !== "undefined" && typeof RTCPeerConnection !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

interface RealtimeEvent {
  type: string;
  [key: string]: unknown;
}

interface Connection {
  pc: RTCPeerConnection;
  channel: RTCDataChannel;
  mic: MediaStream;
  audio: HTMLAudioElement;
  // Proves to our server that requests belong to this live call.
  callToken: string | null;
  disconnectTimer?: ReturnType<typeof setTimeout>;
  // Ends the call at the server's time limit (cost control).
  limitTimer?: ReturnType<typeof setTimeout>;
}

interface Deps {
  businessSlug: string;
  getSessionId: () => string | null;
  updateTurns: (change: (ts: Turn[]) => Turn[]) => void;
  announce: (text: string) => void;
}

export function useVoice({ businessSlug, getSessionId, updateTurns, announce }: Deps) {
  const [state, setState] = useState<VoiceState>("off");
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const conn = useRef<Connection | null>(null);
  // Mic and assistant audio streams, for the orb's level meter.
  const [streams, setStreams] = useState<{ mic: MediaStream | null; remote: MediaStream | null }>({ mic: null, remote: null });

  // Every report to the server goes through one ordered queue: an item is
  // stored before the next one (ids in conversation order, design §3.5) and
  // before any tool the model calls after it.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = useCallback(<T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.current.then(task, task);
    queue.current = run.catch(() => undefined);
    return run;
  }, []);

  // What to do when the server says the call is over (set below, once
  // finish() exists; a ref so post() stays stable).
  const onCallOver = useRef<(message?: string) => void>(() => {});

  const post = useCallback(async (path: string, body: Record<string, unknown>) => {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      // 401 on a call request: the call is over at the server (time limit).
      if (res.status === 401 && path !== "/api/voice/session") onCallOver.current(err.error);
      throw new Error(err.error ?? `${path} failed (${res.status})`);
    }
    return res;
  }, []);

  // Storing a transcript is best effort: a failure costs one line of
  // history, not the call. The secret is read now, not when the queue gets
  // to it, so a report made just before the call ends still goes out.
  const report = useCallback(
    (itemId: string, role: "user" | "assistant", transcript?: string, toolCallIds?: string[]) => {
      const callToken = conn.current?.callToken;
      if (!callToken) return;
      void enqueue(() => post("/api/voice/items", { callToken, itemId, role, transcript, toolCallIds })).catch((err) =>
        console.error("[voice] report failed", err),
      );
    },
    [enqueue, post],
  );

  // Tool results waiting for the answer they belong to (the server attaches
  // the same tool calls, by id, to the stored answer), and the tool calls of
  // the current response (it continues only once all have answered).
  const emptyPending = () => ({ sources: [] as Source[], actions: [] as Action[], toolCallIds: [] as string[] });
  const pending = useRef(emptyPending());
  const toolCalls = useRef<Promise<void>[]>([]);

  // The customer's latest item, until its transcript is reported. A save is
  // checked on the server against what the customer last said (confirm
  // before write), and transcription often finishes after the model has
  // already called the tool, so a tool call waits for it (at most
  // TRANSCRIPT_WAIT_MS; without it the server asks the model to confirm again).
  const heard = useRef<{ itemId: string; transcribed: Promise<void>; done: () => void; wait?: Promise<void> } | null>(null);
  const newHeard = (itemId: string) => {
    let done = () => {};
    const transcribed = new Promise<void>((resolve) => (done = resolve));
    heard.current = { itemId, transcribed, done };
  };
  const markHeard = (itemId: string) => {
    if (heard.current?.itemId === itemId) heard.current.done();
  };
  // One shared wait per item, so tool calls keep their order.
  const untilHeard = () => {
    const h = heard.current;
    if (!h) return Promise.resolve();
    h.wait ??= Promise.race([h.transcribed, new Promise<void>((resolve) => setTimeout(resolve, TRANSCRIPT_WAIT_MS))]);
    return h.wait;
  };

  // Assistant captions, so an interruption or a cut-short response can be
  // settled with what was actually heard. Once finished, late events for
  // the item are ignored (an interruption wins over the full transcript).
  const captions = useRef(new Map<string, { text: string; finished: boolean }>());
  const finishCaption = (itemId: string, text: string) => {
    captions.current.set(itemId, { text, finished: true });
    updateTurns((ts) => voiceCaptionDone(ts, itemId, text));
    report(itemId, "assistant", text);
  };

  const send = (event: Record<string, unknown>) => {
    const channel = conn.current?.channel;
    if (channel?.readyState === "open") channel.send(JSON.stringify(event));
  };

  const runTool = (callId: string, name: string, args: string) => {
    setState("checking");
    const callToken = conn.current?.callToken;
    pending.current.toolCallIds.push(callId);
    const relay = async () => {
      let output: unknown;
      try {
        const res = await post("/api/voice/tool", { callToken, callId, name, arguments: args });
        const result = (await res.json()) as { output: unknown; sources: Source[]; action: Action | null };
        output = result.output;
        pending.current.sources.push(...result.sources);
        if (result.action) pending.current.actions.push(result.action);
      } catch {
        // Same contract as text chat: a failure is a tool result the model
        // can explain, never a silent success.
        output = { ok: false, error: "temporarily_unavailable", message: "The system couldn't complete this right now. Tell the customer it didn't go through." };
      }
      send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) } });
    };
    // Behind the customer's last words (see heard), in the same queue.
    toolCalls.current.push(untilHeard().then(() => enqueue(relay)));
  };

  const onEvent = (event: RealtimeEvent) => {
    switch (event.type) {
      case "session.created":
        setState("listening");
        break;
      case "input_audio_buffer.speech_started":
        setState("hearing");
        break;
      case "input_audio_buffer.speech_stopped":
        setState("thinking");
        break;
      case "conversation.item.added": {
        // Only messages; tool calls and their outputs are items too.
        const item = event.item as { id: string; type: string; role?: string };
        if (item.type !== "message") break;
        if (item.role === "user") {
          updateTurns((ts) => voiceUserItem(ts, item.id));
          report(item.id, "user");
          newHeard(item.id);
        } else if (item.role === "assistant") {
          const { toolCallIds, ...extras } = pending.current;
          pending.current = emptyPending();
          captions.current.set(item.id, { text: "", finished: false });
          updateTurns((ts) => voiceAssistantItem(ts, item.id, extras));
          report(item.id, "assistant", undefined, toolCallIds);
        }
        break;
      }
      case "conversation.item.input_audio_transcription.completed": {
        const itemId = event.item_id as string;
        const transcript = (event.transcript as string) ?? "";
        updateTurns((ts) => voiceUserTranscript(ts, itemId, transcript));
        // Queued first, so a waiting tool call reaches the server after it.
        report(itemId, "user", transcript);
        markHeard(itemId);
        break;
      }
      case "conversation.item.input_audio_transcription.failed":
        updateTurns((ts) => voiceUserTranscript(ts, event.item_id as string, ""));
        markHeard(event.item_id as string);
        break;
      case "response.output_audio_transcript.delta": {
        const itemId = event.item_id as string;
        const caption = captions.current.get(itemId);
        if (caption?.finished) break;
        captions.current.set(itemId, { text: (caption?.text ?? "") + (event.delta as string), finished: false });
        updateTurns((ts) => voiceCaption(ts, itemId, event.delta as string));
        break;
      }
      case "conversation.item.truncated": {
        // The customer talked over this answer: keep what they heard.
        const itemId = event.item_id as string;
        const caption = captions.current.get(itemId);
        if (caption) finishCaption(itemId, heardPart(caption.text, event.audio_end_ms as number));
        break;
      }
      case "response.output_audio_transcript.done": {
        const itemId = event.item_id as string;
        const transcript = (event.transcript as string) ?? "";
        if (captions.current.get(itemId)?.finished) break; // interrupted first
        finishCaption(itemId, transcript);
        if (transcript) announce(transcript);
        break;
      }
      case "response.function_call_arguments.done":
        runTool(event.call_id as string, event.name as string, event.arguments as string);
        break;
      case "response.done": {
        // An answer the response cut short (cancelled before its transcript
        // finished) is settled with what arrived, marked as interrupted.
        const response = event.response as { status?: string; output?: { id: string; type: string; role?: string }[] };
        for (const out of response.output ?? []) {
          const caption = out.type === "message" && out.role === "assistant" ? captions.current.get(out.id) : undefined;
          if (!caption || caption.finished) continue;
          const text = caption.text.trim();
          finishCaption(out.id, response.status === "completed" ? text : text ? `${text}… ${INTERRUPTED}` : INTERRUPTED);
        }
        // With tool calls, the model continues once every output is in.
        const calls = toolCalls.current;
        toolCalls.current = [];
        if (calls.length > 0) void Promise.all(calls).then(() => send({ type: "response.create" }));
        break;
      }
      case "output_audio_buffer.started":
        setState("speaking");
        break;
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        setState((s) => (s === "speaking" ? "listening" : s));
        break;
      case "error":
        console.error("[voice] realtime error", event.error);
        break;
    }
  };
  // The data channel handler is set once; route it to the latest closure.
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  });

  const teardown = useCallback(() => {
    const c = conn.current;
    conn.current = null;
    if (!c) return;
    clearTimeout(c.disconnectTimer);
    clearTimeout(c.limitTimer);
    c.channel.close();
    c.pc.close();
    c.mic.getTracks().forEach((t) => t.stop());
    c.audio.srcObject = null;
    setStreams({ mic: null, remote: null });
    toolCalls.current = [];
    pending.current = emptyPending();
    captions.current.clear();
    heard.current = null;
  }, []);

  const connect = useCallback(async () => {
    setError("");
    setMuted(false);
    setState("connecting");
    let mic: MediaStream;
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      setState(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "failed");
      if (name !== "NotAllowedError") setError("We couldn't use your microphone.");
      return;
    }

    const pc = new RTCPeerConnection();
    const audio = new Audio();
    audio.autoplay = true;
    pc.ontrack = (e) => {
      audio.srcObject = e.streams[0];
      setStreams((s) => ({ ...s, remote: e.streams[0] }));
    };
    mic.getTracks().forEach((track) => pc.addTrack(track, mic));
    const channel = pc.createDataChannel("oai-events");
    channel.onmessage = (e) => {
      try {
        onEventRef.current(JSON.parse(e.data as string) as RealtimeEvent);
      } catch (err) {
        console.error("[voice] bad event", err);
      }
    };
    const drop = () => {
      if (conn.current?.pc !== pc) return;
      teardown();
      setError("The connection dropped.");
      setState("failed");
    };
    pc.onconnectionstatechange = () => {
      const c = conn.current;
      if (c?.pc !== pc) return;
      clearTimeout(c.disconnectTimer);
      if (pc.connectionState === "failed") drop();
      else if (pc.connectionState === "disconnected") {
        c.disconnectTimer = setTimeout(() => {
          if (pc.connectionState === "disconnected" || pc.connectionState === "failed") drop();
        }, DISCONNECT_GRACE_MS);
      }
    };
    conn.current = { pc, channel, mic, audio, callToken: null };
    setStreams({ mic, remote: null });

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const res = await post("/api/voice/session", { businessSlug, sessionId: getSessionId(), sdp: offer.sdp });
      const { sdp, callToken, maxSeconds } = (await res.json()) as { sdp: string; callToken: string; maxSeconds: number };
      if (conn.current?.pc !== pc) return; // ended while connecting
      conn.current.callToken = callToken;
      conn.current.limitTimer = setTimeout(() => onCallOver.current(), maxSeconds * 1000);
      await pc.setRemoteDescription({ type: "answer", sdp });
    } catch (err) {
      if (conn.current?.pc !== pc) return;
      teardown();
      setError(err instanceof Error ? err.message : "Voice isn't available right now.");
      setState("failed");
    }
  }, [businessSlug, getSessionId, post, teardown]);

  // The explainer shows unless the browser already granted the microphone
  // (Firefox can't tell us, so it always shows there).
  const start = useCallback(async () => {
    try {
      const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
      if (status.state === "granted") return void connect();
    } catch {}
    setState("explain");
  }, [connect]);

  const finish = useCallback(
    (notice?: string) => {
      const wasLive = conn.current !== null;
      teardown();
      setState("off");
      if (wasLive) updateTurns((ts) => endVoice(ts, `end-${Date.now()}`, notice));
    },
    [teardown, updateTurns],
  );
  // The customer ends the call (End, Type instead, Continue by text).
  const end = useCallback(() => finish(), [finish]);
  useEffect(() => {
    // The server's message says why (time limit, or the call is gone); the
    // browser's own timer has no message and means the time limit.
    onCallOver.current = (message) => {
      finish(message ?? "Voice session ended: time limit reached");
      if (message) announce(message);
    };
  }, [finish, announce]);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      conn.current?.mic.getAudioTracks().forEach((t) => (t.enabled = m));
      return !m;
    });
  }, []);

  // Leaving the page ends the call (and frees the microphone).
  useEffect(() => teardown, [teardown]);

  return { state, muted, error, streams, start, connect, end, cancel: () => setState("off"), toggleMute };
}
