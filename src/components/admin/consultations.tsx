"use client";

import { CalendarDays, Clock, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ConsultationSort, RequestRow, StatusFilter } from "@/lib/admin/crm";
import { CONSULTATION_STATUSES, type ConsultationStatus } from "@/lib/db/enums";
import { formatInZone, relativeTime } from "./format";
import { AdminHeader } from "./header";
import { LeadDrawer } from "./lead-drawer";
import { Pagination } from "./pagination";
import { CONSULTATIONS_CHANGED, STATUS_LABEL, STATUS_TONE, useToast } from "./ui";

// Consultation requests (US-8.2, 8.3). Pending first by default, soonest
// preferred time first, all times in the business's timezone. Sorted five
// ways, filtered by a range of preferred dates, 25 to a page.

const FILTERS: StatusFilter[] = ["pending", "confirmed", "cancelled", "all"];
const FILTER_LABEL: Record<StatusFilter, string> = { ...STATUS_LABEL, all: "All" };

type Counts = Record<ConsultationStatus, number>;

const SORT_LABEL: Record<ConsultationSort, string> = {
  upcoming: "Upcoming first",
  requested_desc: "Newest requests first",
  requested_asc: "Oldest requests first",
  date_asc: "Preferred date, earliest first",
  date_desc: "Preferred date, latest first",
};

const dateInput =
  "h-9 rounded-lg border border-border bg-surface px-2.5 text-[13px] text-text focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

export function Consultations({ slug, timeZone }: { slug: string; timeZone: string }) {
  const api = `/api/admin/${encodeURIComponent(slug)}`;
  const [filter, setFilter] = useState<StatusFilter>("pending");
  const [sort, setSort] = useState<ConsultationSort>("upcoming");
  // Preferred dates, the business's own ("YYYY-MM-DD"), both included.
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const query = new URLSearchParams({ status: filter, sort, page: String(page), ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString();
  const [data, setData] = useState<{ query: string; requests: RequestRow[]; total: number; pageSize: number; counts: Counts } | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  // Rows with a status change in flight: their select is locked, so a second
  // change can't race the first (and a revert can't undo a later change).
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  // Bumped to load the current tab again (after a save whose outcome is unknown).
  const [reloadKey, setReloadKey] = useState(0);
  const toast = useToast();

  // Only the latest query's answer is kept: clicking through tabs or pages
  // quickly can make an older request answer last.
  useEffect(() => {
    let live = true;
    fetch(`${api}/consultations?${query}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((body: { requests: RequestRow[]; total: number; pageSize: number; counts: Counts }) => {
        if (!live) return;
        // A page left empty (its rows changed elsewhere): the last one there is.
        if (body.requests.length === 0 && page > 1) return setPage(Math.max(1, Math.ceil(body.total / body.pageSize)));
        setData({ query, ...body });
        setFailed(false);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [api, query, page, reloadKey]);

  // Any other filter starts again from page 1.
  const refilter = (change: () => void) => {
    change();
    setPage(1);
  };
  const goTo = (p: number) => {
    setPage(p);
    window.scrollTo({ top: 0 });
  };

  const setRowSaving = (id: string, on: boolean) =>
    setSaving((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  // Optimistic: the row changes at once; if the save fails it goes back and
  // a toast says so. A row that no longer matches the filter stays until
  // the next load, so it doesn't vanish under the cursor.
  const change = async (row: RequestRow, status: ConsultationStatus) => {
    if (status === row.status || saving.has(row.id)) return;
    setRowSaving(row.id, true);
    // Move the row (and one count) from one status to another; reverting is
    // the same move backwards.
    // Only if the row is in the data on screen: after a tab switch the new
    // load already has the true state and counts.
    const move = (from: ConsultationStatus, to: ConsultationStatus) =>
      setData((d) =>
        d && d.requests.some((r) => r.id === row.id)
          ? {
              ...d,
              requests: d.requests.map((r) => (r.id === row.id ? { ...r, status: to } : r)),
              counts: { ...d.counts, [from]: d.counts[from] - 1, [to]: d.counts[to] + 1 },
            }
          : d,
      );
    move(row.status, status);
    try {
      const res = await fetch(`${api}/consultations/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
        // A stalled request must not lock the row forever.
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new SaveError(((await res.json().catch(() => ({}))) as { error?: string }).error);
      toast.show(`Marked as ${STATUS_LABEL[status].toLowerCase()}`);
      window.dispatchEvent(new Event(CONSULTATIONS_CHANGED));
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        // The request may have reached the server and saved: don't guess,
        // load what the database says.
        setReloadKey((k) => k + 1);
        toast.show("The server took too long to answer. The list was refreshed: check the status.", "danger");
      } else {
        move(status, row.status);
        // The server's own message when it gave one; a plain one otherwise.
        toast.show(err instanceof SaveError && err.message ? err.message : "Couldn't change the status. Please try again.", "danger");
      }
    } finally {
      setRowSaving(row.id, false);
    }
  };

  const requests = data?.query === query ? data.requests : null;

  const dated = Boolean(from || to);
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
                  onClick={() => refilter(() => setFilter(f))}
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
              Times shown in {timeZone.replace(/_/g, " ")} time
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-[12px] font-medium text-text-muted">
              Sort
              <select
                value={sort}
                onChange={(e) => refilter(() => setSort(e.target.value as ConsultationSort))}
                className={`${dateInput} pr-8 font-normal`}
              >
                {(Object.keys(SORT_LABEL) as ConsultationSort[]).map((s) => (
                  <option key={s} value={s}>
                    {SORT_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[12px] font-medium text-text-muted">
              Preferred from
              <input type="date" value={from} max={to || undefined} onChange={(e) => refilter(() => setFrom(e.target.value))} className={`${dateInput} font-normal`} />
            </label>
            <label className="flex flex-col gap-1 text-[12px] font-medium text-text-muted">
              to
              <input type="date" value={to} min={from || undefined} onChange={(e) => refilter(() => setTo(e.target.value))} className={`${dateInput} font-normal`} />
            </label>
            {dated && (
              <button
                type="button"
                onClick={() =>
                  refilter(() => {
                    setFrom("");
                    setTo("");
                  })
                }
                className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-[13px] font-medium text-text-muted hover:bg-surface-muted hover:text-text"
              >
                <X aria-hidden className="size-3.5" />
                Clear dates
              </button>
            )}
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
                {dated
                  ? `No ${filter === "all" ? "" : `${FILTER_LABEL[filter].toLowerCase()} `}requests for those dates.`
                  : filter === "all" || filter === "pending"
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
                        <td className="px-5 py-3">
                          {r.service}
                          {r.notes && <p className="mt-0.5 max-w-xs text-[12px] text-text-muted">{r.notes}</p>}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3">{formatInZone(r.preferredAt, timeZone)}</td>
                        <td className="px-5 py-3" onClick={(e) => e.stopPropagation()}>
                          <StatusSelect value={r.status} customer={r.customer} disabled={saving.has(r.id)} onChange={(s) => change(r, s)} />
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
              {data && <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={goTo} label="requests" />}
            </section>
          )}
        </div>
      </main>
      {open && <LeadDrawer slug={slug} leadId={open} timeZone={timeZone} onClose={() => setOpen(null)} />}
      {toast.element}
    </>
  );
}

// A failed save the server answered (its message is safe to show).
class SaveError extends Error {}

// A native select, tinted like the status badge: keyboard and screen-reader
// friendly without a custom menu.
function StatusSelect({
  value,
  customer,
  disabled,
  onChange,
}: {
  value: ConsultationStatus;
  customer: string;
  disabled: boolean;
  onChange: (s: ConsultationStatus) => void;
}) {
  const tones = { warning: "bg-warning/10 text-warning", success: "bg-success/10 text-success", danger: "bg-danger/10 text-danger" };
  return (
    <select
      value={value}
      disabled={disabled}
      aria-busy={disabled}
      aria-label={`Status of ${customer}'s request`}
      onChange={(e) => onChange(e.target.value as ConsultationStatus)}
      className={`h-9 cursor-pointer rounded-md border border-border px-2 text-[13px] font-medium disabled:cursor-wait disabled:opacity-60 ${tones[STATUS_TONE[value]]}`}
    >
      {CONSULTATION_STATUSES.map((s) => (
        <option key={s} value={s}>
          {STATUS_LABEL[s]}
        </option>
      ))}
    </select>
  );
}
