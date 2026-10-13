import { z } from "zod";

// A business's opening hours as rows (the opening_hours table): one row per
// time range, so a day with a lunch break has two and a closed day has none.
// A range can apply to some weeks of the month only ("1st and 3rd
// Saturday"), and dates can be closed (the closed_dates table: holidays).
// Shared by the admin page (editing), the server (validation) and the
// consultation tool (is the business open then?). The database enforces the
// same rules. No server imports.

export interface HoursRow {
  // 1 = Monday ... 7 = Sunday (ISO).
  day: number;
  // "HH:mm", 24-hour. A range closing at "00:00" closes at midnight.
  opens: string;
  closes: string;
  // Which of its weekday in the month it applies to: 1 to 5, and -1 for the
  // last. Empty: every week.
  weeks: number[];
}

// A day the business is closed (a holiday), whatever its weekday's hours.
export interface ClosedDate {
  // "YYYY-MM-DD", the business's local date.
  date: string;
  // Optional: "Christmas Day".
  label: string;
}

// The week: its ranges, how long before closing the last appointment
// starts (minutes; 0 means any time before closing), notes for anything
// else ("seasonal hours in summer"), and the closed dates.
export interface Week {
  hours: HoursRow[];
  lastStartBeforeClose: number;
  notes: string;
  closed: ClosedDate[];
}

export const NOTES_MAX = 500;
export const WEEK_CHOICES = [1, 2, 3, 4, 5, -1] as const;
export const MAX_CLOSED = 100;
export const CLOSED_LABEL_MAX = 80;

export const LAST_START_CHOICES = [0, 15, 30, 45, 60, 90, 120] as const;

export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export const MAX_RANGES_PER_DAY = 4;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// Minutes since midnight; a closing time of 00:00 is the end of the day.
export const minutes = (hhmm: string, closing = false) => {
  const m = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  return closing && m === 0 ? 24 * 60 : m;
};

// Sorted, without repeats; all five weeks is every week.
const normaliseWeeks = (weeks: number[]) => {
  const set = [...new Set(weeks)].sort((a, b) => (a === -1 ? 9 : a) - (b === -1 ? 9 : b));
  return [1, 2, 3, 4, 5].every((w) => set.includes(w)) ? [] : set;
};

const rowSchema = z.object({
  day: z.number({ error: "Choose a day of the week." }).int("Choose a day of the week.").min(1, "Choose a day of the week.").max(7, "Choose a day of the week."),
  opens: z.string().regex(HHMM, "Enter the opening time."),
  closes: z.string().regex(HHMM, "Enter the closing time."),
  weeks: z
    .array(z.number().refine((w) => (WEEK_CHOICES as readonly number[]).includes(w), "Choose weeks of the month."))
    .max(WEEK_CHOICES.length)
    .default([])
    .transform(normaliseWeeks),
});

export interface HoursRowError {
  // Index in the list as sent.
  row: number;
  message: string;
  // Which list: the ranges (default) or the closed dates.
  list?: "closed";
}

// Two ranges can be open on the same date: every week, or a week in common.
const sharesAWeek = (a: number[], b: number[]) => a.length === 0 || b.length === 0 || a.some((w) => b.includes(w));

// The whole week: each range valid, closing after opening, ranges on the
// same day not overlapping (unless they apply to different weeks: "1st and
// 3rd 9 to 1, 2nd and 4th 10 to 2"), at most MAX_RANGES_PER_DAY a day.
// Sorted by day, then opening time.
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
    const overlaps = rows.slice(0, n).some((o) => o.day === r.day && minutes(r.opens) < minutes(o.closes, true) && sharesAWeek(o.weeks, r.weeks));
    if (overlaps) errors.push({ row: r.i, message: "Overlaps other hours that day." });
  }
  if (errors.length) return { ok: false, error: "Some hours need fixing.", errors: errors.sort((a, b) => a.row - b.row) };
  return { ok: true, rows: rows.map(({ day, opens, closes, weeks }) => ({ day, opens, closes, weeks })) };
}

const isDate = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
};

// The closed dates: each a real date, at most once, with a short label.
// Sorted by date. Errors say which row (list: "closed").
export function validateClosed(input: unknown): { ok: true; closed: ClosedDate[] } | { ok: false; error: string; errors: HoursRowError[] } {
  if (input === undefined) return { ok: true, closed: [] };
  if (!Array.isArray(input) || input.length > MAX_CLOSED) return { ok: false, error: `List at most ${MAX_CLOSED} closed dates.`, errors: [] };
  const errors: HoursRowError[] = [];
  const closed: ClosedDate[] = [];
  for (const [i, c] of input.entries()) {
    const date = typeof c?.date === "string" ? c.date : "";
    const label = typeof c?.label === "string" ? c.label.trim() : "";
    if (!isDate(date)) errors.push({ row: i, message: "Enter a date.", list: "closed" });
    else if (label.length > CLOSED_LABEL_MAX) errors.push({ row: i, message: `Keep the label under ${CLOSED_LABEL_MAX} characters.`, list: "closed" });
    else if (closed.some((o) => o.date === date)) errors.push({ row: i, message: "Already listed.", list: "closed" });
    else closed.push({ date, label });
  }
  if (errors.length) return { ok: false, error: "Some closed dates need fixing.", errors };
  return { ok: true, closed: closed.sort((a, b) => a.date.localeCompare(b.date)) };
}

// The week as the admin sends it: the ranges (validateHours), the
// last-start setting, the notes and the closed dates.
export function validateWeek(input: unknown): { ok: true; week: Week } | { ok: false; error: string; errors: HoursRowError[] } {
  const body = (input && typeof input === "object" ? input : {}) as { hours?: unknown; lastStartBeforeClose?: unknown; notes?: unknown; closed?: unknown };
  const last = body.lastStartBeforeClose ?? 0;
  if (typeof last !== "number" || !Number.isInteger(last) || last < 0 || last > 240) return { ok: false, error: "Choose when the last appointment starts.", errors: [] };
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  if (notes.length > NOTES_MAX) return { ok: false, error: `Keep the notes under ${NOTES_MAX} characters.`, errors: [] };
  const hours = validateHours(body.hours);
  const closed = validateClosed(body.closed);
  if (!hours.ok && !closed.ok) return { ok: false, error: hours.error, errors: [...hours.errors, ...closed.errors] };
  if (!hours.ok) return hours;
  if (!closed.ok) return closed;
  return { ok: true, week: { hours: hours.rows, lastStartBeforeClose: last, notes, closed: closed.closed } };
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

const ORDINALS: Record<number, string> = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 5: "5th", [-1]: "last" };

// "1st and 3rd", "1st, 3rd and last".
export function formatWeeks(weeks: number[]): string {
  const names = weeks.map((w) => ORDINALS[w]);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? "");
}

// One line per day, for the customer and the model:
// "Monday: 8:00 AM to 12:00 PM and 1:00 PM to 5:00 PM",
// "Saturday: 9:00 AM to 1:00 PM (1st and 3rd Saturday of the month only)",
// "Sunday: closed".
export function describeHours(rows: HoursRow[]): string[] {
  return DAYS.map((name, i) => {
    const ranges = rows
      .filter((r) => r.day === i + 1)
      .map((r) => `${formatTime(r.opens)} to ${formatTime(r.closes, true)}${r.weeks.length ? ` (${formatWeeks(r.weeks)} ${name} of the month only)` : ""}`);
    return `${name}: ${ranges.length ? ranges.join(" and ") : "closed"}`;
  });
}

const WEEKDAYS_FROM_SUNDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// "Friday, December 25, 2026 (Christmas Day)".
export function formatClosedDate({ date, label }: ClosedDate): string {
  const [y, m, d] = date.split("-").map(Number);
  const weekday = WEEKDAYS_FROM_SUNDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday}, ${MONTHS[m - 1]} ${d}, ${y}${label ? ` (${label})` : ""}`;
}

// The closed dates from today on (the business's local date), soonest
// first: the past ones don't concern a customer.
export const upcomingClosed = (closed: ClosedDate[], today: string, limit = 30) => closed.filter((c) => c.date >= today).slice(0, limit);

export type StartCheck =
  | { ok: true }
  | { ok: false; reason: "closed" }
  | { ok: false; reason: "closed_date"; label: string }
  | { ok: false; reason: "too_late"; latest: string };

// Which of its weekday in the month a date is (1 to 5), and whether it is
// the last one.
export function weekOfMonth(year: number, month: number, day: number): { nth: number; last: boolean } {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { nth: Math.floor((day - 1) / 7) + 1, last: day + 7 > daysInMonth };
}

const appliesTo = (weeks: number[], { nth, last }: { nth: number; last: boolean }) => weeks.length === 0 || weeks.includes(nth) || (last && weeks.includes(-1));

const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// Whether an appointment can start at a local time "YYYY-MM-DDTHH:mm" (the
// business's own timezone, as the consultation tool takes it): within a
// range, from its opening minute, before its closing time, and no later
// than the last start (closing less the setting: "one hour before closing"
// at 5 PM allows 4:00 PM). Each range on its own, so an appointment before a
// lunch break ends by the break. A closed date, or a range for other weeks
// of the month ("1st and 3rd Saturday" on the 4th), is closed. Too late says
// the range's last start. Null when the text isn't such a time.
export function startCheck({ hours, lastStartBeforeClose: last, closed }: Week, local: string): StartCheck | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})$/.exec(local);
  if (!m || !HHMM.test(m[4])) return null;
  const [year, month, date] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const closedDate = closed.find((c) => c.date === local.slice(0, 10));
  if (closedDate) return { ok: false, reason: "closed_date", label: closedDate.label };
  // No weekly hours set: only the closed dates are known.
  if (hours.length === 0) return { ok: true };
  const weekday = new Date(Date.UTC(year, month - 1, date)).getUTCDay();
  const day = weekday === 0 ? 7 : weekday;
  const week = weekOfMonth(year, month, date);
  const at = minutes(m[4]);
  const range = hours.find((r) => r.day === day && appliesTo(r.weeks, week) && at >= minutes(r.opens) && at < minutes(r.closes, true));
  if (!range) return { ok: false, reason: "closed" };
  const latest = Math.max(minutes(range.opens), minutes(range.closes, true) - last);
  return at <= latest || last === 0 ? { ok: true } : { ok: false, reason: "too_late", latest: hhmm(latest) };
}
