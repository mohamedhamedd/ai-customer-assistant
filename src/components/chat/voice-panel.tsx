"use client";

import { Info, Mic, MicOff, PhoneOff, RefreshCw } from "lucide-react";
import { useEffect, useRef } from "react";
import type { VoiceState } from "./use-voice";

// The voice panel replaces the composer while voice mode is on (design brief
// §5.6): the orb, one state label, Mute, End and "Type instead". The thread
// above keeps showing live captions.

export function VoicePanel({
  state,
  muted,
  error,
  businessName,
  level,
  onToggleMute,
  onEnd,
  onReconnect,
}: {
  state: VoiceState;
  muted: boolean;
  error: string;
  businessName: string;
  level: MediaStream | null;
  onToggleMute: () => void;
  onEnd: () => void;
  onReconnect: () => void;
}) {
  const problem = state === "denied" || state === "failed";
  const [label, hint] = labels(state, muted, businessName, error);

  return (
    <div className="flex flex-col gap-2">
      <section
        aria-label="Voice mode"
        className="flex max-h-[280px] flex-col items-center rounded-2xl border border-border bg-surface px-6 py-5 text-center"
      >
        {problem ? (
          <div aria-hidden className="mb-3 flex size-14 items-center justify-center rounded-full border-2 border-danger/60 text-danger">
            <MicOff className="size-6" />
          </div>
        ) : (
          <Orb state={state} muted={muted} stream={level} />
        )}
        <p role="status" aria-live="polite" className="text-[16px] font-semibold leading-tight">
          {label}
        </p>
        {hint && <p className="mt-0.5 text-[14px] leading-tight text-text-muted">{hint}</p>}

        <div className="mt-4 flex w-full max-w-[280px] items-center justify-center gap-3">
          {state === "failed" ? (
            <button type="button" onClick={onReconnect} className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-[14px] font-medium text-accent-contrast hover:opacity-90 md:h-10">
              <RefreshCw aria-hidden className="size-4" />
              Reconnect
            </button>
          ) : state === "denied" ? (
            <button type="button" onClick={onEnd} className="inline-flex h-11 flex-1 items-center justify-center rounded-lg bg-accent px-4 text-[14px] font-medium text-accent-contrast hover:opacity-90 md:h-10">
              Continue by text
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onToggleMute}
                aria-pressed={muted}
                disabled={state === "connecting"}
                className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 text-[14px] font-medium hover:bg-surface-muted disabled:opacity-50 md:h-10"
              >
                {muted ? <Mic aria-hidden className="size-4 text-text-muted" /> : <MicOff aria-hidden className="size-4 text-text-muted" />}
                {muted ? "Unmute" : "Mute"}
              </button>
              <button
                type="button"
                onClick={onEnd}
                className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-danger bg-surface px-4 text-[14px] font-medium text-danger hover:bg-danger/5 md:h-10"
              >
                <PhoneOff aria-hidden className="size-4" />
                End
              </button>
            </>
          )}
        </div>
        {state !== "denied" && (
          <button type="button" onClick={onEnd} className="mt-2.5 min-h-8 text-[13px] text-text-muted hover:text-text hover:underline">
            Type instead
          </button>
        )}
      </section>
      <p className="px-2 text-center text-[12px] leading-snug text-text-muted">
        Voice mode · audio isn&apos;t stored; a text transcript is.
      </p>
    </div>
  );
}

function labels(state: VoiceState, muted: boolean, businessName: string, error: string): [string, string] {
  if (state === "denied") return ["Microphone access is blocked", "Allow it in your browser settings, or keep chatting by text."];
  if (state === "failed") return ["Voice disconnected", error || "Reconnect, or keep chatting by text."];
  if (muted && state !== "connecting") return ["Muted", "Unmute to keep talking."];
  switch (state) {
    case "connecting":
      return ["Connecting…", ""];
    case "thinking":
      return ["Thinking…", ""];
    case "checking":
      return [`Checking ${businessName} info…`, ""];
    case "speaking":
      return ["Speaking…", "Talk anytime to interrupt"];
    default:
      return ["Listening…", ""];
  }
}

// An 88 px accent circle. Its scale follows the audio level of whoever is
// talking (the customer's mic, or the assistant's voice while it speaks),
// read with an AnalyserNode and applied straight to the element, so the
// meter doesn't re-render React 60 times a second. Reduced motion: static.
function Orb({ state, muted, stream }: { state: VoiceState; muted: boolean; stream: MediaStream | null }) {
  const orb = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = orb.current;
    if (!el || !stream || muted || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    let frame = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const s of samples) sum += ((s - 128) / 128) ** 2;
      const level = Math.min(1, Math.sqrt(sum / samples.length) * 4);
      el.style.transform = `scale(${1 + level * 0.18})`;
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
      el.style.transform = "";
      void ctx.close();
    };
  }, [stream, muted]);

  const idle = state === "connecting" || state === "thinking" || state === "checking";
  return (
    <div className="relative mb-3 flex size-24 items-center justify-center">
      <div
        ref={orb}
        aria-hidden
        className={`flex size-[88px] items-center justify-center rounded-full transition-transform duration-75 ${
          muted ? "bg-surface-muted text-text-muted" : "orb-glow bg-accent text-accent-contrast"
        } ${idle && !muted ? "orb-pulse" : ""}`}
      >
        {muted ? <MicOff className="size-7" /> : <Mic className="size-7" />}
      </div>
    </div>
  );
}

export function VoiceExplainer({ onStart, onCancel }: { onStart: () => void; onCancel: () => void }) {
  const start = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    start.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="voice-explainer-title"
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-[440px] flex-col rounded-2xl border border-border bg-surface p-6 shadow-level-2"
      >
        <div aria-hidden className="mb-4 flex size-12 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Mic className="size-6" />
        </div>
        <h2 id="voice-explainer-title" className="mb-2 text-[18px] font-semibold leading-snug">
          Talk to the assistant
        </h2>
        <p className="mb-4 text-[15px] leading-relaxed text-text">
          We use your microphone only while voice mode is on. Audio isn&apos;t stored; a text transcript of the conversation is.
        </p>
        <p className="mb-6 flex items-center gap-2 text-[13px] text-text-muted">
          <Info aria-hidden className="size-4 shrink-0" />
          Your browser will ask for permission next.
        </p>
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onCancel} className="h-11 rounded-lg border border-border bg-surface px-4 text-[14px] font-medium hover:bg-surface-muted md:h-10">
            Cancel
          </button>
          <button
            ref={start}
            type="button"
            onClick={onStart}
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-accent px-4 text-[14px] font-medium text-accent-contrast hover:opacity-90 md:h-10"
          >
            <Mic aria-hidden className="size-4" />
            Start talking
          </button>
        </div>
      </div>
    </div>
  );
}
