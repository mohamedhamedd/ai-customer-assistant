"use client";

import { Loader2, MessageSquare, Mic, Search, Users } from "lucide-react";
import { useEffect, useState } from "react";
import type { LeadRow } from "@/lib/admin/crm";
import { relativeTime } from "./format";
import { AdminHeader } from "./header";
import { LeadDrawer } from "./lead-drawer";

// Leads (US-8.1): everyone who shared contact details with the assistant,
// newest first, searchable by name or email.
export function Leads({ slug, timeZone }: { slug: string; timeZone: string }) {
  const api = `/api/admin/${encodeURIComponent(slug)}`;
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ q: string; leads: LeadRow[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  // Debounced while typing (not on first load), and only the latest answer
  // is kept (typing fast fires several).
  useEffect(() => {
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${api}/leads?q=${encodeURIComponent(query)}`, { cache: "no-store" });
        if (!res.ok) throw new Error();
        const body = (await res.json()) as { leads: LeadRow[] };
        if (live) {
          setResult({ q: query, leads: body.leads });
          setFailed(false);
        }
      } catch {
        if (live) setFailed(true);
      }
    }, query ? 200 : 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [api, query]);

  const leads = result?.leads;
  return (
    <>
      <AdminHeader title="Leads" slug={slug} />
      <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-4">
          <label className="relative w-full sm:w-[320px]">
            <span className="sr-only">Search leads</span>
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
            <input
              type="search"
              value={query}
              maxLength={100}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or email"
              className="h-10 w-full rounded-lg border border-border bg-surface pl-8 pr-3 text-[14px] placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </label>

          {failed && <p className="text-[14px] text-danger">Couldn&apos;t load the leads.</p>}
          {!leads && !failed && (
            <p className="flex items-center gap-2 text-[14px] text-text-muted">
              <Loader2 aria-hidden className="size-4 animate-spin" /> Loading leads…
            </p>
          )}
          {leads && leads.length === 0 && (
            <section className="flex flex-col items-center rounded-2xl border border-border bg-surface p-12 text-center">
              <span aria-hidden className="mb-4 flex size-12 items-center justify-center rounded-full bg-surface-muted text-text-muted">
                <Users className="size-6" />
              </span>
              <p className="max-w-md text-[14px] text-text-muted">
                {result?.q ? "No leads match that search." : "Leads appear here when customers share their details with the assistant, by text or voice."}
              </p>
            </section>
          )}
          {leads && leads.length > 0 && (
            <section aria-label="Leads" className="overflow-hidden rounded-2xl border border-border bg-surface">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-border bg-surface-muted text-[13px]">
                      <th className="px-5 py-2.5 font-medium">Name</th>
                      <th className="px-4 py-2.5 font-medium">Email</th>
                      <th className="px-4 py-2.5 font-medium">Phone</th>
                      <th className="px-4 py-2.5 font-medium">Interest</th>
                      <th className="px-4 py-2.5 font-medium">Channel</th>
                      <th className="px-5 py-2.5 text-right font-medium">Captured</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border text-[14px]">
                    {leads.map((l) => (
                      <tr key={l.id} className="cursor-pointer hover:bg-surface-muted/50" onClick={() => setOpen(l.id)}>
                        <td className="px-5 py-3 font-medium">
                          {/* The row is clickable; the button is the keyboard way in. */}
                          <button type="button" onClick={() => setOpen(l.id)} className="text-left hover:underline focus-visible:outline-2 focus-visible:outline-accent">
                            {l.name}
                          </button>
                          {l.requests > 0 && <span className="ml-2 text-[12px] font-normal text-text-muted">{l.requests} {l.requests === 1 ? "request" : "requests"}</span>}
                        </td>
                        <td className="px-4 py-3 break-all text-text-muted">{l.email ?? "–"}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-text-muted">{l.phone ?? "–"}</td>
                        <td className="px-4 py-3 text-text-muted">{l.interest ?? "–"}</td>
                        <td className="px-4 py-3 text-text-muted">
                          <span className="inline-flex items-center gap-1.5" title={l.channel === "voice" ? "Voice" : "Text chat"}>
                            {l.channel === "voice" ? <Mic aria-hidden className="size-4" /> : <MessageSquare aria-hidden className="size-4" />}
                            <span className="sr-only">{l.channel}</span>
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-right text-text-muted">
                          <time dateTime={l.capturedAt} title={new Date(l.capturedAt).toLocaleString()}>
                            {relativeTime(l.capturedAt)}
                          </time>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </main>
      {open && <LeadDrawer slug={slug} leadId={open} timeZone={timeZone} onClose={() => setOpen(null)} />}
    </>
  );
}
