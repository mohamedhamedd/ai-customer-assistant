"use client";

import { AlertCircle, ArrowLeft, Check, ChevronDown, CircleHelp, Copy, Loader2, MessageSquare, Mic, RefreshCw, Volume2, Wrench, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ConversationRow, Transcript } from "@/lib/admin/conversations";
import { summarizeToolCall, type Tone, type TranscriptMessage, type TranscriptToolCall } from "@/lib/admin/transcript";
import { Markdown } from "@/components/chat/markdown";
import { Sources } from "@/components/chat/sources";
import { formatInZone, relativeTime } from "./format";
import { AdminHeader } from "./header";
import { LeadDrawer } from "./lead-drawer";
import { useCopy } from "./ui";

// Conversations (US-9.1, 9.2): the list on the left, the transcript on the
// right with every tool call the assistant made shown where it happened.
// The open conversation is in the URL (?c=…), so the lead drawer and the
// overview can link to one, and Back goes to the previous one.

export function Conversations({ slug, businessName, timeZone }: { slug: string; businessName: string; timeZone: string }) {
  const api = `/api/admin/${encodeURIComponent(slug)}`;
  const params = useSearchParams();
  const selected = params.get("c");
  // Only conversations with an issue (a replaced answer, a failed save). The
  // overview links here with ?issues=1.
  const [issuesOnly, setIssuesOnly] = useState(params.get("issues") === "1");
  const [list, setList] = useState<ConversationRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  // Bumped by Refresh: loads the list and the open transcript again.
  const [reloadKey, setReloadKey] = useState(0);
  const [showActivity, setShowActivity] = useState(true);
  const [leadOpen, setLeadOpen] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`${api}/conversations${issuesOnly ? "?issues=1" : ""}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((body: { conversations: ConversationRow[] }) => {
        if (!live) return;
        setList(body.conversations);
        setFailed(false);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [api, reloadKey, issuesOnly]);

  // Desktop shows the newest conversation until one is picked; on a phone
  // the list comes first and a pick opens the transcript full width.
  const shown = selected ?? list?.[0]?.id ?? null;
  // Native history calls update useSearchParams without a server round trip.
  const open = (id: string) => window.history.pushState(null, "", `?c=${id}`);
  const backToList = () => window.history.pushState(null, "", window.location.pathname);

  return (
    <>
      <AdminHeader title="Conversations" slug={slug}>
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          aria-label="Refresh"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[13px] font-medium hover:bg-surface-muted sm:px-3"
        >
          <RefreshCw aria-hidden className="size-3.5" />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </AdminHeader>
      <main className="flex min-h-0 flex-1 flex-col p-4 md:p-8">
        {failed && <p className="mb-3 text-[14px] text-danger">Couldn&apos;t load the conversations.</p>}
        {!list && !failed && (
          <p className="flex items-center gap-2 text-[14px] text-text-muted">
            <Loader2 aria-hidden className="size-4 animate-spin" /> Loading conversations…
          </p>
        )}
        {list && list.length === 0 && !selected && !issuesOnly && (
          <section className="flex flex-col items-center rounded-2xl border border-border bg-surface p-12 text-center">
            <span aria-hidden className="mb-4 flex size-12 items-center justify-center rounded-full bg-surface-muted text-text-muted">
              <MessageSquare className="size-6" />
            </span>
            <p className="max-w-md text-[14px] text-text-muted">Conversations appear here when customers chat with or call the assistant.</p>
          </section>
        )}
        {list && (list.length > 0 || selected || issuesOnly) && (
          <div className="flex min-h-0 flex-1 overflow-hidden rounded-2xl border border-border bg-surface">
            <section aria-label="Conversations" className={`min-h-0 w-full flex-col border-border md:flex md:w-[340px] md:shrink-0 md:border-r ${selected ? "hidden" : "flex"}`}>
              <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border bg-surface-muted px-3 text-[13px] font-medium" role="group" aria-label="Show">
                {([false, true] as const).map((issues) => (
                  <button
                    key={String(issues)}
                    type="button"
                    aria-pressed={issuesOnly === issues}
                    onClick={() => setIssuesOnly(issues)}
                    className={`h-8 rounded-md px-2.5 focus-visible:outline-2 focus-visible:outline-accent ${issuesOnly === issues ? "bg-surface shadow-sm" : "text-text-muted hover:text-text"}`}
                  >
                    {issues ? "Issues" : "All"}
                    {issuesOnly === issues && ` (${list.length})`}
                  </button>
                ))}
              </div>
              {issuesOnly && list.length === 0 && <p className="p-4 text-[14px] text-text-muted">No conversations with issues.</p>}
              <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
                {list.map((c) => (
                  <li key={c.id}>
                    <ConversationItem conversation={c} active={c.id === shown} onOpen={() => open(c.id)} />
                  </li>
                ))}
              </ul>
            </section>
            <section aria-label="Transcript" className={`min-h-0 min-w-0 flex-1 flex-col md:flex ${selected ? "flex" : "hidden"}`}>
              {shown ? (
                <TranscriptPane
                  key={shown}
                  api={api}
                  id={shown}
                  businessName={businessName}
                  timeZone={timeZone}
                  reloadKey={reloadKey}
                  showActivity={showActivity}
                  onShowActivity={setShowActivity}
                  onBack={backToList}
                  onOpenLead={setLeadOpen}
                />
              ) : (
                <p className="p-6 text-[14px] text-text-muted">Pick a conversation to read it.</p>
              )}
            </section>
          </div>
        )}
      </main>
      {leadOpen && <LeadDrawer slug={slug} leadId={leadOpen} timeZone={timeZone} onClose={() => setLeadOpen(null)} />}
    </>
  );
}

function ConversationItem({ conversation: c, active, onOpen }: { conversation: ConversationRow; active: boolean; onOpen: () => void }) {
  // Opened from a link (lead drawer, overview), the conversation may be far
  // down the list: bring it into view.
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      aria-current={active ? "true" : undefined}
      className={`flex w-full flex-col gap-1 px-4 py-3 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
        // On a phone the list only shows while nothing is open: the desktop
        // default (the newest) must not look open there.
        active ? "hover:bg-surface-muted/50 md:bg-surface-muted" : "hover:bg-surface-muted/50"
      }`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className={`truncate text-[14px] font-semibold ${c.lead ? "" : "text-text-muted"}`}>{c.lead?.name ?? "Anonymous"}</span>
        <time dateTime={c.lastActivity} title={new Date(c.lastActivity).toLocaleString()} className="shrink-0 text-[12px] text-text-muted">
          {relativeTime(c.lastActivity)}
        </time>
      </span>
      <span className="truncate text-[13px] text-text-muted">{c.preview ?? "No text yet"}</span>
      <span className="flex items-center gap-2 text-[12px] text-text-muted">
        <Channels channels={c.channels} />
        {c.messages} {c.messages === 1 ? "message" : "messages"}
        {c.hasIssue && (
          <span className="flex items-center gap-1 font-medium text-danger">
            <AlertCircle aria-hidden className="size-3" />
            Issue
          </span>
        )}
      </span>
    </button>
  );
}

function Channels({ channels }: { channels: ConversationRow["channels"] }) {
  return (
    <span className="flex items-center gap-1" title={`By ${channels.join(" and ")}`}>
      {channels.includes("text") && <MessageSquare aria-label="Text" className="size-3.5" />}
      {channels.includes("voice") && <Mic aria-label="Voice" className="size-3.5" />}
    </span>
  );
}

function TranscriptPane({
  api,
  id,
  businessName,
  timeZone,
  reloadKey,
  showActivity,
  onShowActivity,
  onBack,
  onOpenLead,
}: {
  api: string;
  id: string;
  businessName: string;
  timeZone: string;
  reloadKey: number;
  showActivity: boolean;
  onShowActivity: (on: boolean) => void;
  onBack: () => void;
  onOpenLead: (leadId: string) => void;
}) {
  const [data, setData] = useState<Transcript | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keyed by conversation (a new pane per conversation), so only Refresh
  // loads this one again; the previous load is ignored if it answers late.
  useEffect(() => {
    let live = true;
    fetch(`${api}/conversations/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then(async (res) => {
        if (res.status === 404) throw new Error("This conversation doesn't exist.");
        if (!res.ok) throw new Error("Couldn't load this conversation.");
        return (await res.json()) as Transcript;
      })
      .then((body) => {
        if (!live) return;
        setData(body);
        setError(null);
      })
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [api, id, reloadKey]);

  const items = data?.items ?? [];
  const toolCalls = items.filter((i) => i.kind === "tool").length;
  const messages = items.length - toolCalls;
  const lead = data?.conversation.lead;

  return (
    <>
      <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border px-4 py-2 md:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" onClick={onBack} aria-label="Back to conversations" className="-ml-2 inline-flex size-9 items-center justify-center rounded-lg hover:bg-surface-muted md:hidden">
            <ArrowLeft aria-hidden className="size-4" />
          </button>
          {data && (
            <p className="min-w-0 truncate">
              <span className="text-[14px] font-semibold">{lead?.name ?? "Anonymous"}</span>
              <span className="ml-2.5 text-[12px] text-text-muted">
                Started {formatInZone(data.conversation.startedAt, timeZone)} · {messages} {messages === 1 ? "message" : "messages"}
              </span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-text-muted">
            <input type="checkbox" role="switch" checked={showActivity} onChange={(e) => onShowActivity(e.target.checked)} className="size-4 accent-accent" />
            Show AI activity{data ? ` (${toolCalls})` : ""}
          </label>
          {lead && (
            <button type="button" onClick={() => onOpenLead(lead.id)} className="text-[12px] font-medium text-accent hover:underline">
              Lead details
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 p-4 md:p-6">
          {error && <p className="text-[14px] text-danger">{error}</p>}
          {!data && !error && (
            <p className="flex items-center gap-2 text-[14px] text-text-muted">
              <Loader2 aria-hidden className="size-4 animate-spin" /> Loading transcript…
            </p>
          )}
          {data?.earlierOmitted && <p className="text-center text-[12px] text-text-muted">Earlier messages aren&apos;t shown: this is the latest part of a long conversation.</p>}
          {items.map((item) =>
            item.kind === "tool" ? (
              showActivity && <ToolCallRow key={`t${item.id}`} call={item} />
            ) : (
              <Message key={`m${item.id}`} message={item} businessName={businessName} timeZone={timeZone} />
            ),
          )}
        </div>
      </div>
    </>
  );
}

// The customer side's message styles, smaller and read-only.
function Message({ message: m, businessName, timeZone }: { message: TranscriptMessage; businessName: string; timeZone: string }) {
  const voice = m.channel === "voice";
  const time = (
    <time dateTime={m.createdAt} className="text-[11px] text-text-muted">
      {formatInZone(m.createdAt, timeZone)}
    </time>
  );
  const noTranscript = <span className="italic opacity-80">No transcript (silence or noise)</span>;
  if (m.role === "user") {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="max-w-[90%] rounded-2xl rounded-br-[4px] md:max-w-[80%] bg-accent px-4 py-2.5 text-[14px] leading-[1.5] whitespace-pre-wrap text-accent-contrast [overflow-wrap:anywhere]">
          {voice && <Mic aria-label="Spoken" className="mr-1.5 inline size-3.5 -translate-y-px" />}
          {m.content ?? noTranscript}
        </div>
        {m.replyFailed && (
          <p className="flex items-center gap-1 text-[12px] font-medium text-danger">
            <AlertCircle aria-hidden className="size-3.5" />
            Not answered: the reply failed
          </p>
        )}
        {time}
      </div>
    );
  }
  return (
    // Full width on a phone: a price table in 80% of 375 px breaks mid-word.
    <div className="flex max-w-full flex-col items-start gap-1.5 md:max-w-[80%]">
      {/* break-words, not overflow-wrap:anywhere: "anywhere" lets a table cell shrink to one letter wide ("$3 / 49"); this way the table keeps its width and scrolls. */}
      <div className="max-w-full rounded-2xl rounded-bl-[4px] bg-surface-muted px-4 py-2.5 text-[14px] leading-[1.5] break-words">
        {voice && <Volume2 aria-label="Spoken answer" className="float-left mr-1.5 mt-1 size-3.5 text-text-muted" />}
        {m.content ? <Markdown text={m.content} /> : noTranscript}
      </div>
      <Sources sources={m.sources} businessName={businessName} />
      {m.replaced && <ReplacedNote replaced={m.replaced} />}
      {time}
    </div>
  );
}

const TONE: Record<Tone, string> = { success: "text-success", warning: "text-warning", danger: "text-danger", neutral: "text-text-muted" };

// `🔧 search_knowledge · "whitening price" · 3 matches · 412 ms ✓`. Opens to
// the arguments and the result; a failed call starts open and is red, so
// problems stand out while scrolling. A write that only proposed its details
// (confirm before write) isn't a problem: it stays closed and grey.
function ToolCallRow({ call }: { call: TranscriptToolCall }) {
  const summary = summarizeToolCall(call);
  const [open, setOpen] = useState(summary.failed);
  const json = JSON.stringify({ arguments: call.arguments, result: call.result }, null, 2);
  return (
    <div className={`rounded-lg border font-mono text-[12px] ${summary.failed ? "border-danger/40 border-l-4 border-l-danger bg-danger/5" : "border-border bg-surface"}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-9 w-full items-center gap-2 px-3 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Wrench aria-hidden className={`size-3.5 shrink-0 ${summary.failed ? "text-danger" : "text-text-muted"}`} />
        {/* One line from sm up; on a phone the parts wrap rather than truncate to nothing. */}
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5 whitespace-nowrap sm:flex-nowrap sm:overflow-hidden">
          <span className={`font-semibold ${summary.failed ? "text-danger" : ""}`}>{call.name}</span>
          {summary.detail && (
            <>
              <span className="text-text-muted">·</span>
              {/* bdi: a query in Arabic keeps its quotes in place. */}
              <bdi className="max-w-full truncate text-text-muted">{summary.detail}</bdi>
            </>
          )}
          <span className="text-text-muted">·</span>
          <span className={`max-w-full truncate font-medium ${TONE[summary.tone]}`}>{summary.outcome}</span>
          <span className="text-text-muted">·</span>
          <span className="shrink-0 text-text-muted">{call.durationMs} ms</span>
          {call.channel === "voice" && <Mic aria-label="During a voice call" className="size-3 shrink-0 text-text-muted" />}
        </span>
        {call.ok ? (
          <Check aria-label="Succeeded" className="size-3.5 shrink-0 text-success" />
        ) : summary.failed ? (
          <X aria-label="Failed" className="size-3.5 shrink-0 text-danger" />
        ) : (
          <CircleHelp aria-label="Proposed, waiting for confirmation" className="size-3.5 shrink-0 text-text-muted" />
        )}
        <ChevronDown aria-hidden className={`size-3.5 shrink-0 text-text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="relative mx-3 mb-3 rounded border border-border bg-bg p-3 text-[11px] leading-relaxed">
          <CopyButton text={json} />
          {/* A search result holds every section the model read: scroll it, don't stretch the transcript. */}
          <pre className="max-h-80 overflow-auto pr-8 whitespace-pre">{json}</pre>
        </div>
      )}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      onClick={() => copy(text)}
      aria-label="Copy JSON"
      title="Copy JSON"
      className="absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded text-text-muted hover:bg-surface-muted hover:text-text"
    >
      {copied ? <Check aria-hidden className="size-3.5 text-success" /> : <Copy aria-hidden className="size-3.5" />}
    </button>
  );
}


// The answer check replaced this answer: the customer saw the safe reply
// above; what the model wrote, and why it was replaced, are one click away.
function ReplacedNote({ replaced }: { replaced: NonNullable<TranscriptMessage["replaced"]> }) {
  return (
    <div className="max-w-full rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-[12px] text-danger">
      <p className="flex items-start gap-1.5 font-medium">
        <AlertCircle aria-hidden className="mt-px size-3.5 shrink-0" />
        <span>
          Replaced by the answer check<span className="font-normal text-text-muted"> · {replaced.reason}</span>
        </span>
      </p>
      <details className="mt-1 text-text-muted">
        <summary className="cursor-pointer">Original answer (not shown to the customer after the check)</summary>
        <p className="mt-1 whitespace-pre-wrap break-words">{replaced.original}</p>
      </details>
    </div>
  );
}
