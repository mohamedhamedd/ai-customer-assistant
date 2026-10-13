import { z } from "zod";

// A business's opening hours as rows (the opening_hours table): one row per
// time range, so a day with a lunch break has two and a closed day has none.
// Shared by the admin page (editing), the server (validation) and the
// consultation tool (is the business open then?). The database enforces the
// same rules. No server imports.

export interface HoursRow {
  // 1 = Monday ... 7 = Sunday (ISO).
  day: number;
  // "HH:mm", 24-hour. A range closing at "00:00" closes at midnight.
  opens: string;
  closes: string;
}

// The week: its ranges, how long before closing the last appointment
// starts (minutes; 0 means any time before closing), and notes for what the
// ranges can't say ("Saturdays: first and third of the month only").
export interface Week {
  hours: HoursRow[];
  lastStartBeforeClose: number;
  notes: string;
}

export const NOTES_MAX = 500;

export const LAST_START_CHOICES = [0, 15, 30, 45, 60, 90, 120] as const;

export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export const MAX_RANGES_PER_DAY = 4;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// Minutes since midnight; a closing time of 00:00 is the end of the day.
export const minutes = (hhmm: string, closing = false) => {
  const m = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  return closing && m === 0 ? 24 * 60 : m;
};

const rowSchema = z.object({
  day: z.number({ error: "Choose a day of the week." }).int("Choose a day of the week.").min(1, "Choose a day of the week.").max(7, "Choose a day of the week."),
  opens: z.string().regex(HHMM, "Enter the opening time."),
  closes: z.string().regex(HHMM, "Enter the closing time."),
});

export interface HoursRowError {
  // Index in the list as sent.
  row: number;
  message: string;
}

// The whole week: each range valid, closing after opening, ranges on the
// same day not overlapping, at most MAX_RANGES_PER_DAY a day. Sorted by day,
// then opening time.
export function validateHours(input: unknown): { ok: true; rows: HoursRow[] } | { ok: false; error: string; errors: HoursRowError[] } {
  if (!Array.isArray(input) || input.length > 7 * MAX_RANGES_PER_DAY) return { ok: false, error: "Send the opening hours as a list.", errors: [] };
  const errors: HoursRowError[] = [];
  const rows: (HoursRow & { i: number })[] = [];
  for (const [i, r] of input.entries()) {
    const parsed = rowSchema.safeParse(r);
    if (!parsed.success) errors.push({ row: i, message: parsed.error.issues[0].message });
    else if (minutes(parsed.data.closes, true) <= minutes(parsed.data.opens)) errors.push({ row: i, message: "Closing must be after opening." });
    else rows.push({ ...parsed.data, i });
  }
  rows.sort((a, b) => a.day - b.day || minutes(a.opens) - minutes(b.opens));
  for (const [n, r] of rows.entries()) {
    const sameDay = rows.filter((o) => o.day === r.day);
    if (sameDay.length > MAX_RANGES_PER_DAY && sameDay.indexOf(r) === MAX_RANGES_PER_DAY) errors.push({ row: r.i, message: `At most ${MAX_RANGES_PER_DAY} time ranges a day.` });
    const before = rows[n - 1];
    if (before?.day === r.day && minutes(r.opens) < minutes(before.closes, true)) errors.push({ row: r.i, message: "Overlaps other hours that day." });
  }
  if (errors.length) return { ok: false, error: "Some hours need fixing.", errors: errors.sort((a, b) => a.row - b.row) };
  return { ok: true, rows: rows.map(({ day, opens, closes }) => ({ day, opens, closes })) };
}

// The week as the admin sends it: the ranges (validateHours), the
// last-start setting and the notes.
export function validateWeek(input: unknown): { ok: true; week: Week } | { ok: false; error: string; errors: HoursRowError[] } {
  const body = (input && typeof input === "object" ? input : {}) as { hours?: unknown; lastStartBeforeClose?: unknown; notes?: unknown };
  const last = body.lastStartBeforeClose ?? 0;
  if (typeof last !== "number" || !Number.isInteger(last) || last < 0 || last > 240) return { ok: false, error: "Choose when the last appointment starts.", errors: [] };
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  if (notes.length > NOTES_MAX) return { ok: false, error: `Keep the notes under ${NOTES_MAX} characters.`, errors: [] };
  const hours = validateHours(body.hours);
  return hours.ok ? { ok: true, week: { hours: hours.rows, lastStartBeforeClose: last, notes } } : hours;
}

// "45 minutes", "1 hour", "1 hour 30 minutes".
export function formatMinutes(n: number): string {
  const h = Math.floor(n / 60);
  const parts = [h ? `${h} ${h === 1 ? "hour" : "hours"}` : "", n % 60 ? `${n % 60} minutes` : ""];
  return parts.filter(Boolean).join(" ");
}

// "9:00 AM", "12:30 PM", "midnight" (a closing time of 00:00).
export function formatTime(hhmm: string, closing = false): string {
  const m = minutes(hhmm, closing);
  if (m === 24 * 60) return "midnight";
  const h = Math.floor(m / 60);
  return `${h % 12 || 12}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

// One line per day, for the customer and the model:
// "Monday: 8:00 AM to 12:00 PM and 1:00 PM to 5:00 PM", "Sunday: closed".
export function describeHours(rows: HoursRow[]): string[] {
  return DAYS.map((name, i) => {
    const ranges = rows.filter((r) => r.day === i + 1).map((r) => `${formatTime(r.opens)} to ${formatTime(r.closes, true)}`);
    return `${name}: ${ranges.length ? ranges.join(" and ") : "closed"}`;
  });
}

export type StartCheck = { ok: true } | { ok: false; reason: "closed" } | { ok: false; reason: "too_late"; latest: string };

const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// Whether an appointment can start at a local time "YYYY-MM-DDTHH:mm" (the
// business's own timezone, as the consultation tool takes it): within a
// range, from its opening minute, before its closing time, and no later
// than the last start (closing less the setting: "one hour before closing"
// at 5 PM allows 4:00 PM). Each range on its own, so an appointment before a
// lunch break ends by the break. Too late says the range's last start. Null
// when the text isn't such a time.
export function startCheck({ hours, lastStartBeforeClose: last }: Week, local: string): StartCheck | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})$/.exec(local);
  if (!m || !HHMM.test(m[4])) return null;
  const weekday = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  const day = weekday === 0 ? 7 : weekday;
  const at = minutes(m[4]);
  const range = hours.find((r) => r.day === day && at >= minutes(r.opens) && at < minutes(r.closes, true));
  if (!range) return { ok: false, reason: "closed" };
  const latest = Math.max(minutes(range.opens), minutes(range.closes, true) - last);
  return at <= latest || last === 0 ? { ok: true } : { ok: false, reason: "too_late", latest: hhmm(latest) };
}
