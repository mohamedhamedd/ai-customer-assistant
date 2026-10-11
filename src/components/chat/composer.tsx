"use client";

import { ArrowUp, Mic } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { COUNTER_FROM, MAX_MESSAGE_CHARS } from "./thread";

const MAX_HEIGHT_PX = 140; // about 5 lines, then it scrolls

// Text input (US-1.2, US-1.3). Enter sends, Shift+Enter adds a line. Sending
// is blocked while a reply is streaming, so there's one turn at a time.
// The text lives in the parent, which can prefill it ("Try again" on a failed
// action card). The textarea's id is COMPOSER_ID, for focusing it.
export const COMPOSER_ID = "composer";

export function Composer({
  busy,
  businessName,
  text,
  setText,
  onSend,
}: {
  busy: boolean;
  businessName: string;
  text: string;
  setText: (text: string) => void;
  onSend: (text: string) => boolean;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const length = text.length;
  const empty = text.trim().length === 0;
  const canSend = !busy && !empty && length <= MAX_MESSAGE_CHARS;

  // Auto-grow: measure the content after each change.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    // Empty: one line, even when the placeholder would wrap on a phone.
    if (text) el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [text]);

  const submit = () => {
    if (!canSend) return;
    // The text stays until the send is accepted.
    if (onSend(text)) setText("");
  };

  const atLimit = length >= MAX_MESSAGE_CHARS;
  const counterId = "composer-counter";

  return (
    <div className="flex flex-col gap-2">
      <div
        className={`flex items-end gap-2 rounded-2xl border bg-surface py-2 pl-4 pr-2 transition-colors focus-within:border-accent focus-within:ring-1 focus-within:ring-accent ${
          atLimit ? "border-danger/60" : "border-border"
        }`}
      >
        <div className="flex min-w-0 flex-1 flex-col py-1">
          <label htmlFor={COMPOSER_ID} className="sr-only">
            Message {businessName}
          </label>
          <textarea
            id={COMPOSER_ID}
            ref={area}
            rows={1}
            value={text}
            maxLength={MAX_MESSAGE_CHARS}
            placeholder="Ask about services, prices, hours…"
            aria-describedby={length >= COUNTER_FROM ? counterId : undefined}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // isComposing: Enter that confirms an IME candidate (Japanese,
              // Chinese…) must not send.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            className="block w-full resize-none bg-transparent placeholder:truncate text-[16px] leading-[1.5] text-text outline-none placeholder:text-text-muted"
          />
          {length >= COUNTER_FROM && (
            <span id={counterId} aria-live="polite" className={`mt-1 text-[12px] font-medium ${atLimit ? "text-danger" : "text-warning"}`}>
              {length.toLocaleString("en-US")} / {MAX_MESSAGE_CHARS.toLocaleString("en-US")}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* Voice arrives with PR-09. */}
          <button
            type="button"
            disabled
            title="Voice is coming soon"
            aria-label="Talk to the assistant (coming soon)"
            className="inline-flex size-11 items-center justify-center rounded-full text-text-muted opacity-50 md:size-9"
          >
            <Mic aria-hidden className="size-5" />
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            aria-label="Send message"
            className="inline-flex size-11 items-center justify-center rounded-full bg-accent text-accent-contrast transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:bg-surface-muted disabled:text-text-muted md:size-9"
          >
            <ArrowUp aria-hidden className="size-4" strokeWidth={2.5} />
          </button>
        </div>
      </div>
      <p className="px-2 text-center text-[12px] leading-snug text-text-muted">
        <span className="md:hidden">AI assistant · may contain mistakes</span>
        <span className="hidden md:inline">
          AI assistant · answers are based on {businessName}&apos;s information and may contain mistakes. Don&apos;t share sensitive personal details.
        </span>
      </p>
    </div>
  );
}
