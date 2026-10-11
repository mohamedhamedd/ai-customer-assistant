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
// rather than arithmetic, which is where models make date mistakes.
export function upcomingDays(now: Date, timeZone: string, days = 14): string[] {
  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const today = wallClock(now, timeZone);
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    // Calendar arithmetic on the date alone: adding 24 h to an instant can
    // land on the same date on the 25-hour day when clocks go back.
    const d = new Date(Date.UTC(today.year, today.month - 1, today.day + i));
    const label = i === 0 ? " (today)" : i === 1 ? " (tomorrow)" : "";
    out.push(`${WEEKDAYS[d.getUTCDay()]} ${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}${label}`);
  }
  return out;
}
