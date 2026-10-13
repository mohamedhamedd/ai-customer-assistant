// Business-timezone date handling, without a date library. Pure functions.
//
// The model resolves "next Tuesday at 3pm" into a LOCAL wall-clock time
// ("2026-10-20T15:00") in the business's timezone; the server converts it to
// UTC. Asking the model for a UTC offset instead would be wrong across a
// daylight-saving change (it knows today's offset, not the one on the date).

const LOCAL_FORMAT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::00)?$/;

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
}

function wallClock(at: Date, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "long",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: get("weekday"),
  };
}

// Minutes the zone is ahead of UTC at a given instant (PDT: -420).
function offsetMinutes(at: Date, timeZone: string): number {
  const w = wallClock(at, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
  return Math.round((asUtc - Math.floor(at.getTime() / 60000) * 60000) / 60000);
}

const pad = (n: number) => String(n).padStart(2, "0");

export function formatLocal(at: Date, timeZone: string): string {
  const w = wallClock(at, timeZone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

// "Tuesday, October 20, 2026 at 3:00 PM PDT". One format everywhere (prompt
// clock, tool results, action cards), so the model never sees one time
// written two ways. The zone label is for that date, so it is right across a
// daylight-saving change (a November request reads PST).
export function formatHuman(at: Date, timeZone: string): string {
  const date = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(at);
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(at);
  return `${date} at ${time}`;
}

export type LocalToUtcResult = { ok: true; at: Date } | { ok: false; reason: "format" | "nonexistent" };

// "2026-10-20T15:00" in America/Los_Angeles -> 2026-10-20T22:00Z.
export function zonedLocalToUtc(local: string, timeZone: string): LocalToUtcResult {
  const m = LOCAL_FORMAT.exec(local.trim());
  if (!m) return { ok: false, reason: "format" };
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return { ok: false, reason: "format" };

  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let at = new Date(guess - offsetMinutes(new Date(guess), timeZone) * 60000);
  // Near a DST change the offset at the guess may differ from the offset at
  // the result; one correction settles it.
  const corrected = new Date(guess - offsetMinutes(at, timeZone) * 60000);
  if (corrected.getTime() !== at.getTime()) at = corrected;

  // A wall time that doesn't exist (the hour skipped when clocks go forward)
  // or a calendar date that doesn't exist (Feb 30) won't round-trip.
  if (formatLocal(at, timeZone) !== `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`) {
    return { ok: false, reason: "nonexistent" };
  }
  return { ok: true, at };
}

// The next `days` dates, so the model maps "next Tuesday" to a date by lookup
// rather than arithmetic, which is where models make date mistakes. Each
// says which of its weekday in the month it is ("4th and last Saturday of
// October"), for hours like "first and third Saturday only": the calendar
// starts today, so the model couldn't count the earlier ones.
// "the 22nd", "October 22", "22 Oct", "10/22".
const EXPLICIT_DATE = /\b\d{1,2}(st|nd|rd|th)\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|\b\d{1,2}\/\d{1,2}\b/i;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// The next `days` dates with their weekday and which week they are in:
// weeks run Monday to Sunday, so "this Thursday" is in this week and "next
// Thursday" in the one after. Seen live: "next Thursday" on a Tuesday was
// read as two days away, "next Wednesday" as eight.
function calendar(now: Date, timeZone: string, days: number) {
  const today = wallClock(now, timeZone);
  const daysLeftInWeek = 6 - ((new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay() + 6) % 7);
  return Array.from({ length: days }, (_, i) => {
    // Calendar arithmetic on the date alone: adding 24 h to an instant can
    // land on the same date on the 25-hour day when clocks go back.
    const d = new Date(Date.UTC(today.year, today.month - 1, today.day + i));
    const week: "this" | "next" | null = i === 0 ? null : i <= daysLeftInWeek ? "this" : i <= daysLeftInWeek + 7 ? "next" : null;
    return { d, i, weekday: WEEKDAYS[d.getUTCDay()], date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, week };
  });
}

// The customer said "next Thursday" and the date is this Thursday (or "this
// Thursday" and it's next week's while this week's is still to come): the
// date they meant, for the tool to refuse with. Their latest message naming
// that weekday decides. Null when it fits, or they named no week.
export function weekMismatch(local: string, said: string[], now: Date, timeZone: string): { said: string; meant: string } | null {
  const days = calendar(now, timeZone, 14);
  const day = days.find((c) => c.date === local.slice(0, 10));
  if (!day?.week) return null;
  const at = said.findLastIndex((m) => new RegExp(`\\b${day.weekday}\\b`, "i").test(m));
  const named = at >= 0 ? said[at].match(new RegExp(`\\b(this|next)\\s+${day.weekday}\\b`, "i")) : null;
  // A date given since ("no, the 22nd") is theirs: the read-back says it back.
  if (!named || said.slice(at + 1).some((m) => EXPLICIT_DATE.test(m))) return null;
  const want = named[1].toLowerCase();
  if (want === day.week) return null;
  const meant = days.find((c) => c.weekday === day.weekday && c.week === want);
  // "This Friday" on a Sunday: no Friday is left this week, so the coming one it is.
  return meant ? { said: named[0], meant: meant.date } : null;
}

export function upcomingDays(now: Date, timeZone: string, days = 14): string[] {
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const NTH = ["1st", "2nd", "3rd", "4th", "5th"];
  return calendar(now, timeZone, days).map(({ d, i, weekday, date, week }) => {
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 7)).getUTCMonth() !== d.getUTCMonth();
    const nth = `${NTH[Math.floor((d.getUTCDate() - 1) / 7)]}${last ? " and last" : ""} ${weekday} of ${MONTHS[d.getUTCMonth()]}`;
    const label = `${i === 0 ? "today; " : i === 1 ? "tomorrow; " : ""}${week ? `${week} ${weekday}; ` : ""}`;
    return `${weekday} ${date} (${label}${nth})`;
  });
}
