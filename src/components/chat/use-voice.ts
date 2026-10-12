"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  endVoice,
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
// (/api/voice/session, so no key or token reaches the browser), runs the
// tools the model calls (/api/voice/tool), and stores the transcripts
// (/api/voice/items). Events arrive on the "oai-events" data channel.

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

  const post = useCallback(
    async (path: string, body: Record<string, unknown>) => {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ businessSlug, sessionId: getSessionId(), ...body }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `${path} failed (${res.status})`);
      }
      return res;
    },
    [businessSlug, getSessionId],
  );

  // Storing a transcript is best effort: a failure costs one line of
  // history, not the call.
  const report = useCallback(
    (itemId: string, role: "user" | "assistant", transcript?: string) =>
      void enqueue(() => post("/api/voice/items", { itemId, role, transcript })).catch((err) => console.error("[voice] report failed", err)),
    [enqueue, post],
  );

  // Tool results waiting for the answer they belong to, and the tool calls
  // of the current response (it continues only once all have answered).
  const pending = useRef<{ sources: Source[]; actions: Action[] }>({ sources: [], actions: [] });
  const toolCalls = useRef<Promise<void>[]>([]);

  const send = (event: Record<string, unknown>) => {
    const channel = conn.current?.channel;
    if (channel?.readyState === "open") channel.send(JSON.stringify(event));
  };

  const runTool = (callId: string, name: string, args: string) => {
    setState("checking");
    const call = enqueue(async () => {
      let output: unknown;
      try {
        const res = await post("/api/voice/tool", { name, arguments: args });
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
    });
    toolCalls.current.push(call);
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
        } else if (item.role === "assistant") {
          const extras = pending.current;
          pending.current = { sources: [], actions: [] };
          updateTurns((ts) => voiceAssistantItem(ts, item.id, extras));
          report(item.id, "assistant");
        }
        break;
      }
      case "conversation.item.input_audio_transcription.completed": {
        const itemId = event.item_id as string;
        const transcript = (event.transcript as string) ?? "";
        updateTurns((ts) => voiceUserTranscript(ts, itemId, transcript));
        report(itemId, "user", transcript);
        break;
      }
      case "conversation.item.input_audio_transcription.failed":
        updateTurns((ts) => voiceUserTranscript(ts, event.item_id as string, ""));
        break;
      case "response.output_audio_transcript.delta":
        updateTurns((ts) => voiceCaption(ts, event.item_id as string, event.delta as string));
        break;
      case "response.output_audio_transcript.done": {
        const itemId = event.item_id as string;
        const transcript = (event.transcript as string) ?? "";
        updateTurns((ts) => voiceCaptionDone(ts, itemId, transcript));
        report(itemId, "assistant", transcript);
        if (transcript) announce(transcript);
        break;
      }
      case "response.function_call_arguments.done":
        runTool(event.call_id as string, event.name as string, event.arguments as string);
        break;
      case "response.done": {
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
    c.channel.close();
    c.pc.close();
    c.mic.getTracks().forEach((t) => t.stop());
    c.audio.srcObject = null;
    setStreams({ mic: null, remote: null });
    toolCalls.current = [];
    pending.current = { sources: [], actions: [] };
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
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        if (conn.current?.pc !== pc) return;
        teardown();
        setError("Voice disconnected.");
        setState("failed");
      }
    };
    conn.current = { pc, channel, mic, audio };
    setStreams({ mic, remote: null });

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const res = await post("/api/voice/session", { sdp: offer.sdp });
      const { sdp } = (await res.json()) as { sdp: string };
      if (conn.current?.pc !== pc) return; // ended while connecting
      await pc.setRemoteDescription({ type: "answer", sdp });
    } catch (err) {
      if (conn.current?.pc !== pc) return;
      teardown();
      setError(err instanceof Error ? err.message : "Voice isn't available right now.");
      setState("failed");
    }
  }, [post, teardown]);

  // The explainer shows unless the browser already granted the microphone
  // (Firefox can't tell us, so it always shows there).
  const start = useCallback(async () => {
    try {
      const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
      if (status.state === "granted") return void connect();
    } catch {}
    setState("explain");
  }, [connect]);

  const end = useCallback(() => {
    const wasLive = conn.current !== null;
    teardown();
    setState("off");
    if (wasLive) updateTurns((ts) => endVoice(ts, `end-${Date.now()}`));
  }, [teardown, updateTurns]);

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
