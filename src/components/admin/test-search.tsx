"use client";

import { CheckCircle2, HelpCircle, Loader2, Search } from "lucide-react";
import { useState } from "react";

interface Result {
  documentId: string;
  title: string;
  heading: string;
  excerpt: string;
  similarity: number;
}

// "What would the assistant find?" (US-7.5): the same search and found rule
// as the assistant's search_knowledge tool, without asking the model.
export function TestSearch({ api }: { api: string }) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<{ kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "done"; found: boolean; results: Result[] }>({ kind: "idle" });

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setState({ kind: "loading" });
    try {
      const res = await fetch(`${api}/search`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setState({ kind: "done", ...(body as { found: boolean; results: Result[] }) });
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error && err.message ? err.message : "The search failed. Please try again." });
    }
  };

  return (
    <section aria-label="Test search" className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-[14px] font-semibold">Test search</h2>
      <p className="mt-0.5 text-[13px] text-text-muted">Check what the assistant would find for a customer&apos;s question.</p>
      <form onSubmit={run} className="mt-3 flex gap-2">
        <label className="relative flex-1">
          <span className="sr-only">Question</span>
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <input
            value={query}
            maxLength={500}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. How much is teeth whitening?"
            className="h-10 w-full rounded-lg border border-border bg-surface pl-8 pr-3 text-[14px] placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>
        <button type="submit" disabled={state.kind === "loading" || !query.trim()} className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-[14px] font-medium hover:bg-surface-muted disabled:opacity-50">
          {state.kind === "loading" && <Loader2 aria-hidden className="size-4 animate-spin" />}
          Search
        </button>
      </form>

      <div aria-live="polite">
        {state.kind === "error" && <p className="mt-3 text-[13px] text-danger">{state.message}</p>}
        {state.kind === "done" && (
          <div className="mt-4">
            <p className={`flex items-center gap-1.5 text-[13px] font-medium ${state.found ? "text-success" : "text-warning"}`}>
              {state.found ? <CheckCircle2 aria-hidden className="size-4" /> : <HelpCircle aria-hidden className="size-4" />}
              {state.found ? "The assistant would answer from these sections." : "Nothing relevant enough: the assistant would say it doesn't have that information."}
            </p>
            <p className="mt-1 text-[12px] text-text-muted">In the order the assistant receives them: meaning and keyword matches combined, so a lower % can rank higher.</p>
            <ol className="mt-3 flex flex-col divide-y divide-border">
              {state.results.map((r, i) => (
                <li key={`${r.documentId}-${i}`} className="flex flex-col gap-1.5 py-3 sm:flex-row sm:gap-4">
                  <div className="flex shrink-0 items-center gap-2 sm:w-36">
                    <span className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
                      <span className="block h-full rounded-full bg-info" style={{ width: `${Math.max(0, Math.min(1, r.similarity)) * 100}%` }} />
                    </span>
                    <span className="text-[12px] tabular-nums text-text-muted">{(r.similarity * 100).toFixed(0)}%</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium break-words">
                      {r.title}
                      {r.heading && <span className="text-text-muted"> › {r.heading}</span>}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-[13px] text-text-muted">{r.excerpt}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}
