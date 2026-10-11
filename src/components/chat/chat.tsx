"use client";

import { AlertCircle, ArrowDown, Loader2, MoreHorizontal, RefreshCw, Sparkles, WifiOff } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ActionCard } from "./action-card";
import { Composer } from "./composer";
import { Markdown } from "./markdown";
import { Sources } from "./sources";
import { canRetry, toolStatus, visibleActions, type Action, type Turn } from "./thread";
import { useChat } from "./use-chat";

export interface ChatBusiness {
  slug: string;
  name: string;
}

// Generic on purpose: the UI is the same for any business (D-14). Per-business
// questions come with business settings (PR-15).
const SUGGESTIONS = ["What services do you offer?", "What are your hours?", "How much does it cost?", "Request a consultation"];

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

export function Chat({ business }: { business: ChatBusiness }) {
  const chat = useChat(business.slug);
  const actions = visibleActions(chat.turns);
  const empty = chat.history === "ready" && chat.turns.length === 0;

  // Follow the reply while the reader is at the bottom; if they scrolled up
  // to read, leave them there and offer "Jump to latest".
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (atBottom.current) el.scrollTop = el.scrollHeight;
    else setShowJump(true);
  }, [chat.turns]);
  const onScroll = () => {
    const el = scroller.current!;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottom.current) setShowJump(false);
  };
  const jump = () => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
    atBottom.current = true;
    setShowJump(false);
  };
  // A message the customer sends always scrolls into view.
  const send = (text: string) => {
    atBottom.current = true;
    return chat.send(text);
  };

  return (
    <div className="flex h-dvh flex-col bg-bg">
      <Header business={business} onNewConversation={chat.newConversation} canReset={!chat.busy && chat.turns.length > 0} />

      {!chat.online && (
        <div role="status" className="flex items-center justify-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2.5 text-[13px] font-medium text-warning">
          <WifiOff aria-hidden className="size-4 shrink-0" />
          You&apos;re offline. Messages will send when you&apos;re back.
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <div ref={scroller} onScroll={onScroll} className="h-full overflow-y-auto px-4 py-8">
          {/* aria-live is off here (streaming would read every fragment);
              the finished answer is announced by the region below. */}
          <div role="log" aria-live="off" aria-label="Conversation" className="mx-auto flex max-w-[760px] flex-col gap-6">
            {chat.startedFresh && <Notice text="New conversation started" />}
            {chat.history === "loading" && (
              <p className="flex items-center gap-2 text-[14px] text-text-muted">
                <Loader2 aria-hidden className="size-4 animate-spin" />
                Loading conversation…
              </p>
            )}
            {chat.history === "failed" && (
              <div className="flex flex-col items-start gap-2">
                <p className="text-[14px] text-text-muted">Couldn&apos;t load this conversation.</p>
                <SmallButton onClick={chat.reloadHistory}>
                  <RefreshCw aria-hidden className="size-3.5" />
                  Try again
                </SmallButton>
              </div>
            )}
            {chat.history === "ready" && <Welcome business={business} showSuggestions={empty} onPick={send} />}
            {chat.turns.map((turn, i) => (
              <TurnView
                key={turn.key}
                turn={turn}
                actions={actions[i]}
                businessName={business.name}
                retryable={canRetry(chat.turns, i)}
                onRetry={chat.retry}
                onTryAgain={i === chat.turns.length - 1 && !chat.busy ? () => send("Please try that again.") : undefined}
              />
            ))}
          </div>
        </div>
        {showJump && (
          <button
            type="button"
            onClick={jump}
            className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-[12px] font-medium shadow-level-2 hover:bg-surface-muted"
          >
            <ArrowDown aria-hidden className="size-3.5" />
            Jump to latest
          </button>
        )}
      </div>

      <div className="sr-only" aria-live="polite">
        {chat.announcement}
      </div>

      <footer className="shrink-0 px-4 pb-4 pt-2">
        <div className="mx-auto max-w-[760px]">
          <Composer busy={chat.busy || chat.history === "loading"} businessName={business.name} onSend={send} />
        </div>
      </footer>
    </div>
  );
}

function Header({ business, onNewConversation, canReset }: { business: ChatBusiness; onNewConversation: () => void; canReset: boolean }) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => !menu.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <header className="z-20 flex h-[60px] shrink-0 items-center justify-center border-b border-border bg-surface">
      <div className="flex w-full max-w-[760px] items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-[14px] font-semibold text-accent-contrast select-none">
            {initials(business.name)}
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-[16px] font-semibold leading-tight">{business.name}</h1>
            <p className="mt-0.5 text-[12px] leading-tight text-text-muted">AI assistant</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="flex items-center gap-1.5 text-[12px] text-text-muted select-none">
            <span aria-hidden className="size-2 rounded-full bg-success" />
            <span className="hidden sm:inline">Online</span>
          </span>
          <div ref={menu} className="relative">
            <button
              type="button"
              aria-label="More options"
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
              className="inline-flex size-11 items-center justify-center rounded-lg text-text-muted hover:bg-surface-muted hover:text-text md:size-8"
            >
              <MoreHorizontal aria-hidden className="size-5" />
            </button>
            {open && (
              <div role="menu" className="absolute right-0 top-[calc(100%+4px)] z-30 w-52 rounded-lg border border-border bg-surface p-1 shadow-level-2">
                <button
                  type="button"
                  role="menuitem"
                  autoFocus
                  disabled={!canReset}
                  onClick={() => {
                    onNewConversation();
                    setOpen(false);
                  }}
                  className="flex min-h-10 w-full items-center rounded-md px-3 text-left text-[14px] hover:bg-surface-muted disabled:text-text-muted disabled:hover:bg-transparent"
                >
                  New conversation
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

function Welcome({ business, showSuggestions, onPick }: { business: ChatBusiness; showSuggestions: boolean; onPick: (text: string) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <AssistantRow>
        <div className="rounded-2xl rounded-bl-[4px] bg-surface-muted px-5 py-3.5 text-[16px] leading-[1.5]">
          Hi! I&apos;m {business.name}&apos;s assistant. Ask me about services, prices, or hours — or request a consultation.
        </div>
      </AssistantRow>
      {showSuggestions && (
        <ul aria-label="Suggested questions" className="flex flex-col items-start gap-2 pl-10 md:flex-row md:flex-wrap">
          {SUGGESTIONS.map((q) => (
            <li key={q}>
              <button
                type="button"
                onClick={() => onPick(q)}
                className="min-h-10 rounded-full border border-border bg-surface px-4 text-[14px] hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {q}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TurnView({
  turn,
  actions,
  businessName,
  retryable,
  onRetry,
  onTryAgain,
}: {
  turn: Turn;
  actions: Action[];
  businessName: string;
  retryable: boolean;
  onRetry: () => void;
  onTryAgain?: () => void;
}) {
  const reply = turn.reply;
  return (
    <>
      {turn.userText && (
        <div className="flex flex-col items-end gap-1.5">
          <div
            className={`max-w-[85%] rounded-2xl rounded-br-[4px] bg-accent px-5 py-3.5 text-[16px] leading-[1.5] whitespace-pre-wrap text-accent-contrast [overflow-wrap:anywhere] md:max-w-[520px] ${
              turn.sendState === "notSent" ? "outline-2 outline-offset-2 outline-danger" : ""
            } ${turn.sendState === "sending" ? "opacity-80" : ""}`}
          >
            {turn.userText}
          </div>
          {turn.sendState === "notSent" && (
            <p role="alert" className="flex max-w-[85%] items-start gap-1 text-right text-[12px] font-medium text-danger md:max-w-[520px]">
              <AlertCircle aria-hidden className="mt-px size-3.5 shrink-0" />
              <span>
                Not sent · {turn.sendError?.message}
                {retryable && (
                  <>
                    {" · "}
                    <button type="button" onClick={onRetry} className="underline underline-offset-2">
                      Retry
                    </button>
                  </>
                )}
              </span>
            </p>
          )}
        </div>
      )}

      {reply && (
        <AssistantRow>
          <div className="flex min-w-0 flex-col gap-2">
            {actions.map((a, i) => (
              <ActionCard key={i} action={a} businessName={businessName} onTryAgain={a.kind === "action_failed" ? onTryAgain : undefined} />
            ))}

            {reply.activeTool && (
              <p className="flex items-center gap-2 py-1 text-[14px] text-text-muted">
                <Loader2 aria-hidden className="size-3.5 shrink-0 animate-spin" />
                <span className="truncate">{toolStatus(reply.activeTool, businessName)}</span>
              </p>
            )}

            {reply.phase === "waiting" && !reply.activeTool && (
              <div aria-label="Assistant is thinking" className="flex h-10 w-fit items-center gap-1.5 rounded-2xl rounded-bl-[4px] bg-surface-muted px-4">
                <span className="dot size-2 rounded-full bg-text-muted" />
                <span className="dot size-2 rounded-full bg-text-muted" />
                <span className="dot size-2 rounded-full bg-text-muted" />
              </div>
            )}

            {reply.text && (
              <div className="rounded-2xl rounded-bl-[4px] bg-surface-muted px-5 py-3.5 text-[16px] leading-[1.5] [overflow-wrap:anywhere]">
                <Markdown text={reply.text} />
                {reply.phase === "streaming" && <span aria-hidden className="caret ml-0.5 inline-block h-4 w-2 translate-y-0.5 bg-accent" />}
              </div>
            )}

            {reply.phase === "error" && reply.error && reply.error.retryable && (
              <div className="flex flex-col items-start gap-2.5">
                <div role="alert" className="rounded-2xl rounded-bl-[4px] bg-surface-muted px-5 py-3.5 text-[16px] leading-[1.5]">
                  {reply.error.message}
                </div>
                {retryable && (
                  <SmallButton onClick={onRetry}>
                    <RefreshCw aria-hidden className="size-3.5" />
                    Retry
                  </SmallButton>
                )}
              </div>
            )}
            {reply.phase === "error" && reply.error && !reply.error.retryable && (
              <p role="alert" className="flex items-start gap-1.5 text-[13px] text-text-muted">
                <AlertCircle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warning" />
                {reply.error.message}
              </p>
            )}

            {reply.phase === "done" && <Sources sources={reply.sources} businessName={businessName} />}
          </div>
        </AssistantRow>
      )}
    </>
  );
}

function AssistantRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div aria-hidden className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-muted text-accent">
        <Sparkles className="size-4" />
      </div>
      <div className="min-w-0 max-w-[560px] flex-1">{children}</div>
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-px flex-1 bg-border" />
      <span className="text-[12px] text-text-muted">{text}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

function SmallButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      {children}
    </button>
  );
}
