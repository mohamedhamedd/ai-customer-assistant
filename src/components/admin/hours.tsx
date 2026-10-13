"use client";

import { ChevronDown, Copy, Loader2, Plus, X } from "lucide-react";
import { useRef, useState } from "react";
import {
  CLOSED_LABEL_MAX,
  DAYS,
  formatMinutes,
  formatWeeks,
  LAST_START_CHOICES,
  MAX_CLOSED,
  MAX_RANGES_PER_DAY,
  minutes,
  NOTES_MAX,
  WEEK_CHOICES,
  type ClosedDate,
  type HoursRow,
  type HoursRowError,
  type Week,
} from "@/lib/admin/hours-rows";
import { AdminHeader } from "./header";
import { useToast } from "./ui";

// Opening hours: the business's week, one or more time ranges a day (a lunch
// break is two; a range can be for some weeks of the month only), or
// closed; when the last appointment starts; notes; and closed dates
// (holidays). Saved at once. Consultation requests for a time no
// appointment can start are refused in code.

const timeInput =
  "h-9 w-[7.5rem] rounded-lg border bg-surface px-2.5 text-[14px] text-text focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

// Ranges with a key for React, so editing one doesn't remount the others.
// The key is also in the inputs' ids, so the first render numbers them from
// 0 on the server and in the browser alike (a shared counter didn't: React
// reported a hydration mismatch); later ones count on per page.
type Keyed = HoursRow & { key: number };
const numbered = (rows: HoursRow[], first: number): Keyed[] => rows.map((r, i) => ({ ...r, key: first + i }));
const plain = (rows: Keyed[]): HoursRow[] => rows.map(({ day, opens, closes, weeks }) => ({ day, opens, closes, weeks }));
const sorted = (rows: HoursRow[]) => [...rows].sort((a, b) => a.day - b.day || minutes(a.opens) - minutes(b.opens));

// Closed dates, keyed the same way (their own numbers: their ids say "closed").
type KeyedDate = ClosedDate & { key: number };
const numberedDates = (dates: ClosedDate[], first: number): KeyedDate[] => dates.map((d, i) => ({ ...d, key: first + i }));
const plainDates = (dates: KeyedDate[]): ClosedDate[] => dates.map(({ date, label }) => ({ date, label }));

// The weeks control's label: "Every week", "1st and 3rd only".
const weeksLabel = (weeks: number[]) => {
  if (!weeks.length) return "Every week";
  const text = `${formatWeeks(weeks)} only`;
  return text[0].toUpperCase() + text.slice(1);
};

// "HH:mm" plus some hours, at most midnight ("00:00").
const later = (hhmm: string, hours: number) => {
  const m = Math.min(minutes(hhmm, true) + hours * 60, 24 * 60);
  return m === 24 * 60 ? "00:00" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

const without = (errors: Record<number, string>, key: number) => Object.fromEntries(Object.entries(errors).filter(([k]) => Number(k) !== key));

// today: the business's local date ("YYYY-MM-DD"), to mark past closed dates.
export function OpeningHours({ slug, timeZone, today, initial }: { slug: string; timeZone: string; today: string; initial: Week }) {
  const api = `/api/admin/${encodeURIComponent(slug)}/hours`;
  const toast = useToast();
  const [saved, setSaved] = useState(initial);
  const [rows, setRows] = useState(() => numbered(initial.hours, 0));
  const nextKey = useRef(initial.hours.length);
  const keyed = (rs: HoursRow[]): Keyed[] => {
    const first = nextKey.current;
    nextKey.current += rs.length;
    return numbered(rs, first);
  };
  const [lastStart, setLastStart] = useState(initial.lastStartBeforeClose);
  const [notes, setNotes] = useState(initial.notes);
  const [dates, setDates] = useState(() => numberedDates(initial.closed, 0));
  const nextDateKey = useRef(initial.closed.length);
  const keyedDates = (ds: ClosedDate[]): KeyedDate[] => {
    const first = nextDateKey.current;
    nextDateKey.current += ds.length;
    return numberedDates(ds, first);
  };
  // By key: errors stay on their range (or date) while others are added or removed.
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [dateErrors, setDateErrors] = useState<Record<number, string>>({});
  // Ranges whose weeks control is open.
  const [weeksOpen, setWeeksOpen] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);

  const sortedDates = (ds: ClosedDate[]) => [...ds].sort((a, b) => a.date.localeCompare(b.date));
  const dirty =
    JSON.stringify(sorted(plain(rows))) !== JSON.stringify(sorted(saved.hours)) ||
    lastStart !== saved.lastStartBeforeClose ||
    notes.trim() !== saved.notes ||
    JSON.stringify(sortedDates(plainDates(dates)).map((d) => ({ ...d, label: d.label.trim() }))) !== JSON.stringify(saved.closed);

  const update = (key: number, field: "opens" | "closes", value: string) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
    setErrors((es) => without(es, key));
  };
  const remove = (key: number) => {
    setRows((rs) => rs.filter((r) => r.key !== key));
    setErrors((es) => without(es, key));
  };
  const add = (day: number) => {
    const last = rows.filter((r) => r.day === day).sort((a, b) => minutes(a.opens) - minutes(b.opens)).at(-1);
    const range = last ? { opens: last.closes === "00:00" ? "23:00" : last.closes, closes: later(last.closes, 2) } : { opens: "09:00", closes: "17:00" };
    setRows((rs) => [...rs, ...keyed([{ day, ...range, weeks: [] }])]);
  };
  const toggleWeek = (key: number, week: number) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, weeks: r.weeks.includes(week) ? r.weeks.filter((w) => w !== week) : [...r.weeks, week].sort((a, b) => (a === -1 ? 9 : a) - (b === -1 ? 9 : b)) } : r)));
    setErrors((es) => without(es, key));
  };
  const toggleWeeksOpen = (key: number) =>
    setWeeksOpen((open) => {
      const next = new Set(open);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const updateDate = (key: number, field: "date" | "label", value: string) => {
    setDates((ds) => ds.map((d) => (d.key === key ? { ...d, [field]: value } : d)));
    setDateErrors((es) => without(es, key));
  };
  const removeDate = (key: number) => {
    setDates((ds) => ds.filter((d) => d.key !== key));
    setDateErrors((es) => without(es, key));
  };
  const addDate = () => {
    const added = keyedDates([{ date: "", label: "" }]);
    setDates((ds) => [...ds, ...added]);
    setTimeout(() => document.getElementById(`closed-${added[0].key}-date`)?.focus(), 0);
  };
  // Monday's hours on every weekday (Tuesday to Friday), replacing theirs.
  const copyMonday = () => {
    const monday = rows.filter((r) => r.day === 1);
    setRows((rs) => [...rs.filter((r) => r.day < 2 || r.day > 5), ...[2, 3, 4, 5].flatMap((day) => keyed(monday.map((r) => ({ day, opens: r.opens, closes: r.closes, weeks: r.weeks }))))]);
    setErrors({});
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    const sent = rows;
    const sentDates = dates;
    try {
      const res = await fetch(api, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hours: plain(sent), lastStartBeforeClose: lastStart, notes, closed: plainDates(sentDates) }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<Week> & { error?: string; rows?: HoursRowError[] };
      if (res.ok && Array.isArray(body.hours) && typeof body.lastStartBeforeClose === "number" && typeof body.notes === "string" && Array.isArray(body.closed)) {
        setSaved({ hours: body.hours, lastStartBeforeClose: body.lastStartBeforeClose, notes: body.notes, closed: body.closed });
        setRows(keyed(body.hours));
        setLastStart(body.lastStartBeforeClose);
        setNotes(body.notes);
        setDates(keyedDates(body.closed));
        setErrors({});
        setDateErrors({});
        return toast.show("Opening hours saved");
      }
      // The server numbers the ranges and dates as sent.
      const problems = body.rows ?? [];
      setErrors(Object.fromEntries(problems.flatMap((e) => (!e.list && sent[e.row] ? [[sent[e.row].key, e.message]] : []))));
      setDateErrors(Object.fromEntries(problems.flatMap((e) => (e.list === "closed" && sentDates[e.row] ? [[sentDates[e.row].key, e.message]] : []))));
      toast.show(body.error ?? "Couldn't save. Please try again.", "danger");
    } catch {
      toast.show("Couldn't save. Please try again.", "danger");
    } finally {
      setSaving(false);
    }
  };

  const open = new Set(rows.map((r) => r.day)).size;

  return (
    <>
      <AdminHeader title="Opening hours" slug={slug} />

      <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-8">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          <p className="text-[14px] text-text-muted">
            When the business is open, in its own timezone (<span className="font-medium text-text">{timeZone}</span>). The assistant won&apos;t send a consultation
            request for a time you&apos;re closed; it suggests a time within these hours instead. Add a second range for a lunch break.
          </p>
          <div>
            <button
              type="button"
              onClick={copyMonday}
              disabled={!rows.some((r) => r.day === 1)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] font-medium hover:bg-surface-muted disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent"
            >
              <Copy aria-hidden className="size-3.5" />
              Copy Monday to Tuesday–Friday
            </button>
          </div>

          <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
            {DAYS.map((name, i) => {
              const day = i + 1;
              const ranges = rows.filter((r) => r.day === day);
              return (
                <li key={day} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
                  <span className="w-28 shrink-0 pt-2 text-[14px] font-medium">{name}</span>
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    {ranges.length === 0 && <span className="pt-2 text-[14px] text-text-muted">Closed</span>}
                    {ranges.map((r) => {
                      const error = errors[r.key];
                      const id = `hours-${r.key}`;
                      return (
                        <div key={r.key}>
                          <div className="flex flex-wrap items-center gap-2">
                            <label htmlFor={`${id}-opens`} className="sr-only">
                              {name} opens
                            </label>
                            <input
                              id={`${id}-opens`}
                              type="time"
                              value={r.opens}
                              onChange={(e) => update(r.key, "opens", e.target.value)}
                              aria-invalid={!!error}
                              aria-describedby={error ? `${id}-error` : undefined}
                              className={`${timeInput} ${error ? "border-danger" : "border-border"}`}
                            />
                            <span className="text-[13px] text-text-muted">to</span>
                            <label htmlFor={`${id}-closes`} className="sr-only">
                              {name} closes
                            </label>
                            <input
                              id={`${id}-closes`}
                              type="time"
                              value={r.closes}
                              onChange={(e) => update(r.key, "closes", e.target.value)}
                              aria-invalid={!!error}
                              aria-describedby={error ? `${id}-error` : undefined}
                              className={`${timeInput} ${error ? "border-danger" : "border-border"}`}
                            />
                            <button
                              type="button"
                              onClick={() => toggleWeeksOpen(r.key)}
                              aria-expanded={weeksOpen.has(r.key)}
                              aria-controls={`${id}-weeks`}
                              className={`inline-flex h-9 items-center gap-1 rounded-lg px-2 text-[13px] hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent ${r.weeks.length ? "font-medium text-accent" : "text-text-muted"}`}
                            >
                              {weeksLabel(r.weeks)}
                              <ChevronDown aria-hidden className={`size-3.5 transition-transform ${weeksOpen.has(r.key) ? "rotate-180" : ""}`} />
                            </button>
                            <button
                              type="button"
                              onClick={() => remove(r.key)}
                              aria-label={`Remove ${name}'s hours from ${r.opens} to ${r.closes}`}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-text-muted hover:bg-surface-muted hover:text-danger focus-visible:outline-2 focus-visible:outline-accent"
                            >
                              <X aria-hidden className="size-4" />
                            </button>
                          </div>
                          {weeksOpen.has(r.key) && (
                            <div id={`${id}-weeks`} role="group" aria-label={`Which ${name}s of the month`} className="mt-2 flex flex-wrap items-center gap-1.5">
                              <span className="mr-1 text-[12px] text-text-muted">Which {name}s:</span>
                              {WEEK_CHOICES.map((w) => (
                                <button
                                  key={w}
                                  type="button"
                                  aria-pressed={r.weeks.includes(w)}
                                  onClick={() => toggleWeek(r.key, w)}
                                  className={`h-8 min-w-11 rounded-full border px-2.5 text-[13px] focus-visible:outline-2 focus-visible:outline-accent ${
                                    r.weeks.includes(w) ? "border-accent bg-accent text-accent-contrast" : "border-border hover:bg-surface-muted"
                                  }`}
                                >
                                  {w === -1 ? "Last" : formatWeeks([w])}
                                </button>
                              ))}
                              <span className="text-[12px] text-text-muted">{r.weeks.length ? "" : "None chosen: every week"}</span>
                            </div>
                          )}
                          {error && (
                            <p id={`${id}-error`} className="mt-1 text-[12px] text-danger">
                              {error}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {ranges.length < MAX_RANGES_PER_DAY && (
                    <button
                      type="button"
                      onClick={() => add(day)}
                      className="inline-flex h-9 shrink-0 items-center gap-1.5 self-start rounded-lg px-2 text-[13px] font-medium text-accent hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      <Plus aria-hidden className="size-3.5" />
                      {ranges.length ? "Add hours" : "Open this day"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-[13px] text-text-muted">A range ending at 12:00 AM closes at midnight.</p>

          <div className="flex flex-col gap-1.5 rounded-2xl border border-border bg-surface px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
            <label htmlFor="last-start" className="w-28 shrink-0 text-[14px] font-medium sm:w-auto">
              Last appointment starts
            </label>
            <select
              id="last-start"
              value={lastStart}
              onChange={(e) => setLastStart(Number(e.target.value))}
              className="h-9 rounded-lg border border-border bg-surface px-2.5 text-[14px] text-text focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              {LAST_START_CHOICES.map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? "any time before closing" : `${formatMinutes(m)} before closing`}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5 rounded-2xl border border-border bg-surface px-4 py-3">
            <label htmlFor="hours-notes" className="text-[14px] font-medium">
              Notes
            </label>
            <p id="hours-notes-help" className="text-[13px] text-text-muted">
              Anything else about the hours, like seasonal hours. The assistant gives these with the hours. (For some weeks only, use the weeks choice on a day&apos;s hours; for holidays, Closed dates below: those are checked.)
            </p>
            <textarea
              id="hours-notes"
              value={notes}
              maxLength={NOTES_MAX}
              rows={3}
              onChange={(e) => setNotes(e.target.value)}
              aria-describedby="hours-notes-help"
              placeholder="e.g. Shorter hours in August: the team will confirm."
              className="w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-[14px] text-text placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <span className="self-end text-[12px] text-text-muted">
              {notes.length}/{NOTES_MAX}
            </span>
          </div>

          <section aria-labelledby="closed-title" className="flex flex-col gap-2 rounded-2xl border border-border bg-surface px-4 py-3">
            <h2 id="closed-title" className="text-[14px] font-medium">
              Closed dates
            </h2>
            <p className="text-[13px] text-text-muted">Holidays and other days you&apos;re closed, whatever the weekly hours. The assistant won&apos;t send a request for them.</p>
            {dates.length > 0 && (
              <ul className="flex flex-col gap-2">
                {dates.map((d) => {
                  const error = dateErrors[d.key];
                  const id = `closed-${d.key}`;
                  return (
                    <li key={d.key}>
                      <div className="flex flex-wrap items-center gap-2">
                        <label htmlFor={`${id}-date`} className="sr-only">
                          Closed date
                        </label>
                        <input
                          id={`${id}-date`}
                          type="date"
                          value={d.date}
                          onChange={(e) => updateDate(d.key, "date", e.target.value)}
                          aria-invalid={!!error}
                          aria-describedby={error ? `${id}-error` : undefined}
                          className={`h-9 rounded-lg border bg-surface px-2.5 text-[14px] text-text focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent ${error ? "border-danger" : "border-border"}`}
                        />
                        <label htmlFor={`${id}-label`} className="sr-only">
                          Label
                        </label>
                        <input
                          id={`${id}-label`}
                          value={d.label}
                          maxLength={CLOSED_LABEL_MAX}
                          placeholder="e.g. Christmas Day (optional)"
                          onChange={(e) => updateDate(d.key, "label", e.target.value)}
                          className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface px-2.5 text-[14px] text-text placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                        {d.date && d.date < today && <span className="text-[12px] text-text-muted">Past</span>}
                        <button
                          type="button"
                          onClick={() => removeDate(d.key)}
                          aria-label={`Remove closed date ${d.date || "(no date)"}`}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-text-muted hover:bg-surface-muted hover:text-danger focus-visible:outline-2 focus-visible:outline-accent"
                        >
                          <X aria-hidden className="size-4" />
                        </button>
                      </div>
                      {error && (
                        <p id={`${id}-error`} className="mt-1 text-[12px] text-danger">
                          {error}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {dates.length < MAX_CLOSED && (
              <button
                type="button"
                onClick={addDate}
                className="inline-flex h-9 items-center gap-1.5 self-start rounded-lg px-2 text-[13px] font-medium text-accent hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent"
              >
                <Plus aria-hidden className="size-3.5" />
                Add closed date
              </button>
            )}
          </section>

          {/* Down to the window's edge: past main's own padding, so rows don't show below it. */}
          <div className="sticky -bottom-4 -mx-4 -mb-4 flex items-center justify-end gap-3 border-t border-border bg-bg px-4 py-3 md:-bottom-8 md:-mx-8 md:-mb-8 md:px-8">
            <span className="mr-auto text-[13px] text-text-muted">
              Open {open} {open === 1 ? "day" : "days"} a week
              {dirty && " · unsaved changes"}
            </span>
            <button
              type="button"
              disabled={!dirty || saving}
              onClick={() => {
                setRows(keyed(saved.hours));
                setLastStart(saved.lastStartBeforeClose);
                setNotes(saved.notes);
                setDates(keyedDates(saved.closed));
                setErrors({});
                setDateErrors({});
              }}
              className="h-10 whitespace-nowrap rounded-lg px-3 text-[14px] font-medium text-text-muted hover:text-text disabled:opacity-50 sm:px-4"
            >
              Discard<span className="hidden sm:inline"> changes</span>
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!dirty || saving}
              aria-busy={saving}
              className="inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-lg bg-accent px-4 text-[14px] font-medium text-accent-contrast hover:opacity-90 disabled:opacity-50"
            >
              {saving && <Loader2 aria-hidden className="size-4 animate-spin" />}
              Save<span className="hidden sm:inline"> changes</span>
            </button>
          </div>
        </div>
      </main>
      {toast.element}
    </>
  );
}
