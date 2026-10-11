"use client";

import { FileText, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Markdown } from "./markdown";
import { uniqueSources, type Source } from "./thread";

const VISIBLE = 3;

const label = (s: Source) => (s.heading ? `${s.title} › ${s.heading}` : s.title);

// Source chips under an answer (US-3.2). A chip opens the passage the answer
// came from: a popover on desktop, a bottom sheet on mobile (same element,
// positioned by breakpoint).
export function Sources({ sources, businessName }: { sources: Source[]; businessName: string }) {
  const unique = uniqueSources(sources);
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const chips = useRef<(HTMLButtonElement | null)[]>([]);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const close = () => {
    const index = open;
    setOpen(null);
    if (index !== null) chips.current[index]?.focus();
  };

  // Escape or a click outside closes it.
  useEffect(() => {
    if (open === null) return;
    // Open below the last answer: bring it into view inside the thread.
    panel.current?.focus({ preventScroll: true });
    panel.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panel.current?.contains(target) || chips.current.some((c) => c?.contains(target))) return;
      setOpen(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
    // close() only reads `open`, which is a dependency already.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (unique.length === 0) return null;
  const shown = expanded ? unique : unique.slice(0, VISIBLE);
  const hidden = unique.length - shown.length;
  const source = open === null ? null : unique[open];

  return (
    <div className="relative">
      <ul className="flex flex-wrap items-center gap-2" aria-label="Sources">
        {shown.map((s, i) => (
          <li key={`${s.documentId}|${s.heading}`} className="max-w-full">
            <button
              ref={(el) => {
                chips.current[i] = el;
              }}
              type="button"
              aria-expanded={open === i}
              aria-haspopup="dialog"
              onClick={() => setOpen(open === i ? null : i)}
              className={`inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-[13px] text-text transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                open === i ? "ring-2 ring-accent ring-offset-1 ring-offset-bg" : ""
              }`}
            >
              <FileText aria-hidden className="size-3.5 shrink-0 text-info" />
              <span className="truncate">{label(s)}</span>
            </button>
          </li>
        ))}
        {hidden > 0 && (
          <li>
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="inline-flex min-h-8 items-center rounded-full border border-border bg-surface px-2.5 py-1 text-[13px] text-text-muted hover:bg-surface-muted hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              +{hidden} more
            </button>
          </li>
        )}
      </ul>

      {source && (
        <>
          {/* Backdrop for the mobile sheet only. */}
          <div aria-hidden className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setOpen(null)} />
          <div
            ref={panel}
            role="dialog"
            aria-labelledby={titleId}
            tabIndex={-1}
            className="fixed inset-x-0 bottom-0 z-40 max-h-[70dvh] overflow-y-auto rounded-t-2xl border border-border bg-surface p-5 shadow-level-2 outline-none md:absolute md:inset-x-auto md:bottom-auto md:left-0 md:top-[calc(100%+8px)] md:max-h-[400px] md:w-[380px] md:rounded-xl md:p-4"
          >
            <div aria-hidden className="mx-auto mb-4 h-1 w-10 rounded-full bg-border md:hidden" />
            <div className="flex items-start justify-between gap-2 pb-3">
              <div className="flex min-w-0 items-start gap-2.5">
                <FileText aria-hidden className="mt-0.5 size-4 shrink-0 text-info" />
                <div className="min-w-0">
                  <h3 id={titleId} className="text-[14px] font-semibold leading-snug break-words">
                    {source.title}
                  </h3>
                  {source.heading && <p className="mt-0.5 text-[12px] text-text-muted break-words">Section: {source.heading}</p>}
                </div>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close source"
                className="-mr-2 -mt-2 inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-surface-muted hover:text-text md:size-8"
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>
            <div className="-mx-5 h-px bg-border md:-mx-4" />
            {/* Documents are stored as markdown (tables, lists), like the answers. */}
            <div className="py-3.5 text-[14px] leading-[1.6] [overflow-wrap:anywhere]">
              <Markdown text={source.excerpt} />
            </div>
            <p className="border-t border-border pt-2 text-[12px] text-text-muted">From {businessName}&apos;s documents</p>
          </div>
        </>
      )}
    </div>
  );
}
