"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { pageNumbers } from "./pages";

// "26–50 of 132" with Previous, page numbers and Next, for the admin's long
// lists. Page numbers: the first, the last, and two around the current one,
// with gaps between ("1 … 4 5 6 … 12"). Nothing when it all fits on one page.

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
  label,
  compact = false,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  // What's listed: "conversations", "requests".
  label: string;
  // A narrow column: no page numbers, just Previous / Next.
  compact?: boolean;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize && page === 1) return null;
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  const button =
    "inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-lg px-2 text-[13px] font-medium hover:bg-surface-muted disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent";
  return (
    <nav aria-label={`Pages of ${label}`} className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
      <p className="text-[12px] text-text-muted" aria-live="polite">
        {first}–{last} of {total} {label}
      </p>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page" className={button}>
          <ChevronLeft aria-hidden className="size-4" />
          {!compact && <span className="hidden sm:inline">Previous</span>}
        </button>
        {!compact &&
          pageNumbers(page, pages).map((p, i) =>
            p === "gap" ? (
              <span key={`gap-${i}`} aria-hidden className="px-1 text-[13px] text-text-muted">
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => onPage(p)}
                aria-label={`Page ${p}`}
                aria-current={p === page ? "page" : undefined}
                className={`${button} ${p === page ? "border border-border bg-surface shadow-sm" : "text-text-muted"}`}
              >
                {p}
              </button>
            ),
          )}
        {compact && (
          <span className="px-1 text-[12px] text-text-muted">
            {page} / {pages}
          </span>
        )}
        <button type="button" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page" className={button}>
          {!compact && <span className="hidden sm:inline">Next</span>}
          <ChevronRight aria-hidden className="size-4" />
        </button>
      </div>
    </nav>
  );
}
