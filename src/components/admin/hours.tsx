"use client";

import { Copy, Loader2, Plus, X } from "lucide-react";
import { useState } from "react";
import { DAYS, formatMinutes, LAST_START_CHOICES, MAX_RANGES_PER_DAY, minutes, NOTES_MAX, type HoursRow, type HoursRowError, type Week } from "@/lib/admin/hours-rows";
import { AdminHeader } from "./header";
import { useToast } from "./ui";

// Opening hours: the business's week, one or more time ranges a day (a lunch
// break is two), or closed, and when the last appointment starts. Saved at
// once. Consultation requests for a time no appointment can start are
// refused in code.

const timeInput =
  "h-9 w-[7.5rem] rounded-lg border bg-surface px-2.5 text-[14px] text-text focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

// Ranges with a key for React, so editing one doesn't remount the others.
type Keyed = HoursRow & { key: number };
let nextKey = 0;
const keyed = (rows: HoursRow[]): Keyed[] => rows.map((r) => ({ ...r, key: nextKey++ }));
const plain = (rows: Keyed[]): HoursRow[] => rows.map(({ day, opens, closes }) => ({ day, opens, closes }));
const sorted = (rows: HoursRow[]) => [...rows].sort((a, b) => a.day - b.day || minutes(a.opens) - minutes(b.opens));

// "HH:mm" plus some hours, at most midnight ("00:00").
const later = (hhmm: string, hours: number) => {
  const m = Math.min(minutes(hhmm, true) + hours * 60, 24 * 60);
  return m === 24 * 60 ? "00:00" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

const without = (errors: Record<number, string>, key: number) => Object.fromEntries(Object.entries(errors).filter(([k]) => Number(k) !== key));

export function OpeningHours({ slug, timeZone, initial }: { slug: string; timeZone: string; initial: Week }) {
  const api = `/api/admin/${encodeURIComponent(slug)}/hours`;
  const toast = useToast();
  const [saved, setSaved] = useState(initial);
  const [rows, setRows] = useState(() => keyed(initial.hours));
  const [lastStart, setLastStart] = useState(initial.lastStartBeforeClose);
  const [notes, setNotes] = useState(initial.notes);
  // By key: errors stay on their range while others are added or removed.
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);

  const dirty = JSON.stringify(sorted(plain(rows))) !== JSON.stringify(sorted(saved.hours)) || lastStart !== saved.lastStartBeforeClose || notes.trim() !== saved.notes;

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
    setRows((rs) => [...rs, ...keyed([{ day, ...range }])]);
  };
  // Monday's hours on every weekday (Tuesday to Friday), replacing theirs.
  const copyMonday = () => {
    const monday = rows.filter((r) => r.day === 1);
    setRows((rs) => [...rs.filter((r) => r.day < 2 || r.day > 5), ...[2, 3, 4, 5].flatMap((day) => keyed(monday.map((r) => ({ day, opens: r.opens, closes: r.closes }))))]);
    setErrors({});
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    const sent = rows;
    try {
      const res = await fetch(api, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hours: plain(sent), lastStartBeforeClose: lastStart, notes }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<Week> & { error?: string; rows?: HoursRowError[] };
      if (res.ok && Array.isArray(body.hours) && typeof body.lastStartBeforeClose === "number" && typeof body.notes === "string") {
        setSaved({ hours: body.hours, lastStartBeforeClose: body.lastStartBeforeClose, notes: body.notes });
        setRows(keyed(body.hours));
        setLastStart(body.lastStartBeforeClose);
        setNotes(body.notes);
        setErrors({});
        return toast.show("Opening hours saved");
      }
      // The server numbers the ranges as sent.
      setErrors(Object.fromEntries((body.rows ?? []).flatMap((e) => (sent[e.row] ? [[sent[e.row].key, e.message]] : []))));
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
                              onClick={() => remove(r.key)}
                              aria-label={`Remove ${name}'s hours from ${r.opens} to ${r.closes}`}
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
              What the hours above can&apos;t say: days that differ by week, holidays, seasonal hours. The assistant gives these with the hours.
            </p>
            <textarea
              id="hours-notes"
              value={notes}
              maxLength={NOTES_MAX}
              rows={3}
              onChange={(e) => setNotes(e.target.value)}
              aria-describedby="hours-notes-help"
              placeholder="e.g. Saturdays: first and third of the month only. Closed on major US public holidays."
              className="w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-[14px] text-text placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <span className="self-end text-[12px] text-text-muted">
              {notes.length}/{NOTES_MAX}
            </span>
          </div>

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
                setErrors({});
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
