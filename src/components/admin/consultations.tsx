"use client";

import { CalendarDays, Clock, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { RequestRow, StatusFilter } from "@/lib/admin/crm";
import { CONSULTATION_STATUSES, type ConsultationStatus } from "@/lib/db/enums";
import { formatInZone, relativeTime, zoneLabel } from "./format";
import { AdminHeader } from "./header";
import { LeadDrawer } from "./lead-drawer";
import { CONSULTATIONS_CHANGED, STATUS_LABEL, STATUS_TONE, useToast } from "./ui";

// Consultation requests (US-8.2, 8.3). Pending first by default, soonest
// preferred time first, all times in the business's timezone.

const FILTERS: StatusFilter[] = ["pending", "confirmed", "cancelled", "all"];
const FILTER_LABEL: Record<StatusFilter, string> = { ...STATUS_LABEL, all: "All" };

type Counts = Record<ConsultationStatus, number>;

export function Consultations({ slug, timeZone }: { slug: string; timeZone: string }) {
  const api = `/api/admin/${encodeURIComponent(slug)}`;
  const [filter, setFilter] = useState<StatusFilter>("pending");
  const [data, setData] = useState<{ filter: StatusFilter; requests: RequestRow[]; counts: Counts } | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(
    async (f: StatusFilter) => {
      try {
        const res = await fetch(`${api}/consultations?status=${f}`, { cache: "no-store" });
        if (!res.ok) throw new Error();
        const body = (await res.json()) as { requests: RequestRow[]; counts: Counts };
        setData({ filter: f, ...body });
        setFailed(false);
      } catch {
        setFailed(true);
      }
    },
    [api],
  );

  useEffect(() => {
    // Fetching on filter change; the state is set when the response arrives.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(filter);
  }, [filter, load]);

  // Optimistic: the row changes at once; if the save fails it goes back and
  // a toast says so. A row that no longer matches the filter stays until
  // the next load, so it doesn't vanish under the cursor.
  const change = async (row: RequestRow, status: ConsultationStatus) => {
    if (status === row.status) return;
    // Move the row (and one count) from one status to another; reverting is
    // the same move backwards.
    const move = (from: ConsultationStatus, to: ConsultationStatus) =>
      setData((d) =>
        d && {
          ...d,
          requests: d.requests.map((r) => (r.id === row.id ? { ...r, status: to } : r)),
          counts: { ...d.counts, [from]: d.counts[from] - 1, [to]: d.counts[to] + 1 },
        },
      );
    move(row.status, status);
    try {
      const res = await fetch(`${api}/consultations/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error);
      toast.show(`Marked as ${STATUS_LABEL[status].toLowerCase()}`);
      window.dispatchEvent(new Event(CONSULTATIONS_CHANGED));
    } catch (err) {
      move(status, row.status);
      toast.show(err instanceof Error && err.message ? err.message : "Couldn't change the status. Please try again.", "danger");
    }
  };

  const requests = data?.filter === filter ? data.requests : null;
  return (
    <>
      <AdminHeader title="Consultations" slug={slug} />
      <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-5">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div role="tablist" aria-label="Status" className="inline-flex w-fit items-center rounded-lg border border-border bg-surface-muted p-1">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  role="tab"
                  aria-selected={filter === f}
                  onClick={() => setFilter(f)}
                  className={`flex min-h-9 items-center gap-1.5 rounded-md px-3 text-[13px] ${filter === f ? "border border-border bg-surface font-semibold shadow-sm" : "text-text-muted hover:text-text"}`}
                >
                  {FILTER_LABEL[f]}
                  {f === "pending" && data && data.counts.pending > 0 && (
                    <span className="rounded-full bg-warning/15 px-1.5 text-[11px] font-semibold text-warning">{data.counts.pending}</span>
                  )}
                </button>
              ))}
            </div>
            <p className="flex items-center gap-1.5 text-[12px] text-text-muted">
              <Clock aria-hidden className="size-3.5" />
              Times shown in {zoneLabel(timeZone)}
            </p>
          </div>

          {failed && <p className="text-[14px] text-danger">Couldn&apos;t load the requests.</p>}
          {!requests && !failed && (
            <p className="flex items-center gap-2 text-[14px] text-text-muted">
              <Loader2 aria-hidden className="size-4 animate-spin" /> Loading requests…
            </p>
          )}
          {requests && requests.length === 0 && (
            <section className="flex flex-col items-center rounded-2xl border border-border bg-surface p-12 text-center">
              <span aria-hidden className="mb-4 flex size-12 items-center justify-center rounded-full bg-surface-muted text-text-muted">
                <CalendarDays className="size-6" />
              </span>
              <p className="max-w-md text-[14px] text-text-muted">
                {filter === "all" || filter === "pending"
                  ? "Consultation requests appear here when customers ask the assistant for one."
                  : `No ${FILTER_LABEL[filter].toLowerCase()} requests.`}
              </p>
            </section>
          )}
          {requests && requests.length > 0 && (
            <section aria-label="Consultation requests" className="overflow-hidden rounded-2xl border border-border bg-surface">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-border bg-surface-muted text-[13px]">
                      <th className="px-5 py-3 font-medium">Customer</th>
                      <th className="px-5 py-3 font-medium">Contact</th>
                      <th className="px-5 py-3 font-medium">Service</th>
                      <th className="px-5 py-3 font-medium">Preferred date &amp; time</th>
                      <th className="w-44 px-5 py-3 font-medium">Status</th>
                      <th className="px-5 py-3 text-right font-medium">Requested</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border text-[14px]">
                    {requests.map((r) => (
                      <tr key={r.id} className="cursor-pointer hover:bg-surface-muted/50" onClick={() => setOpen(r.leadId)}>
                        <td className="px-5 py-3 font-medium">
                          <button type="button" onClick={() => setOpen(r.leadId)} className="text-left hover:underline focus-visible:outline-2 focus-visible:outline-accent">
                            {r.customer}
                          </button>
                        </td>
                        <td className="px-5 py-3 break-all text-text-muted">{r.email ?? r.phone}</td>
                        <td className="px-5 py-3">{r.service}</td>
                        <td className="whitespace-nowrap px-5 py-3">{formatInZone(r.preferredAt, timeZone)}</td>
                        <td className="px-5 py-3" onClick={(e) => e.stopPropagation()}>
                          <StatusSelect value={r.status} customer={r.customer} onChange={(s) => change(r, s)} />
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-right text-[13px] text-text-muted">
                          <time dateTime={r.requestedAt} title={new Date(r.requestedAt).toLocaleString()}>
                            {relativeTime(r.requestedAt)}
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
      {open && <LeadDrawer api={api} leadId={open} timeZone={timeZone} onClose={() => setOpen(null)} />}
      {toast.element}
    </>
  );
}

// A native select, tinted like the status badge: keyboard and screen-reader
// friendly without a custom menu.
function StatusSelect({ value, customer, onChange }: { value: ConsultationStatus; customer: string; onChange: (s: ConsultationStatus) => void }) {
  const tones = { warning: "bg-warning/10 text-warning", success: "bg-success/10 text-success", danger: "bg-danger/10 text-danger" };
  return (
    <select
      value={value}
      aria-label={`Status of ${customer}'s request`}
      onChange={(e) => onChange(e.target.value as ConsultationStatus)}
      className={`h-9 cursor-pointer rounded-md border border-border px-2 text-[13px] font-medium ${tones[STATUS_TONE[value]]}`}
    >
      {CONSULTATION_STATUSES.map((s) => (
        <option key={s} value={s}>
          {STATUS_LABEL[s]}
        </option>
      ))}
    </select>
  );
}
