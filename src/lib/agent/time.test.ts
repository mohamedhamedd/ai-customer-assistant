import { test } from "node:test";
import assert from "node:assert/strict";
import { formatHuman, formatLocal, upcomingDays, zonedLocalToUtc } from "./time";

const LA = "America/Los_Angeles";

test("local time converts with the offset in force ON THAT DATE, not today's", () => {
  // October: daylight time, UTC-7.
  const oct = zonedLocalToUtc("2026-10-20T15:00", LA);
  assert.ok(oct.ok);
  assert.equal(oct.at.toISOString(), "2026-10-20T22:00:00.000Z");
  // November, after clocks go back on Nov 1: standard time, UTC-8.
  const nov = zonedLocalToUtc("2026-11-03T15:00", LA);
  assert.ok(nov.ok);
  assert.equal(nov.at.toISOString(), "2026-11-03T23:00:00.000Z");
});

test("other timezones and seconds suffix", () => {
  const r = zonedLocalToUtc("2026-10-20T09:30:00", "Europe/London");
  assert.ok(r.ok);
  assert.equal(r.at.toISOString(), "2026-10-20T08:30:00.000Z");
});

test("bad formats and impossible times are rejected", () => {
  for (const bad of ["2026-10-20 15:00", "2026-10-20T15:00Z", "2026-10-20T15:00-07:00", "next tuesday", "2026-13-01T10:00", "2026-10-20T24:00"]) {
    const r = zonedLocalToUtc(bad, LA);
    assert.equal(r.ok, false, bad);
    if (!r.ok) assert.equal(r.reason, "format", bad);
  }
  // A date that doesn't exist on the calendar.
  const feb = zonedLocalToUtc("2027-02-30T10:00", LA);
  assert.deepEqual(feb, { ok: false, reason: "nonexistent" });
  // 2:30 AM is skipped when clocks go forward (2027-03-14 in the US).
  const gap = zonedLocalToUtc("2027-03-14T02:30", LA);
  assert.deepEqual(gap, { ok: false, reason: "nonexistent" });
});

test("formatting round-trips", () => {
  const at = new Date("2026-10-20T22:00:00Z");
  assert.equal(formatLocal(at, LA), "2026-10-20T15:00");
  assert.equal(formatHuman(at, LA), "Tuesday, October 20, 2026 at 3:00 PM");
});

test("the zone label belongs to the date shown, not to today", () => {
  assert.equal(formatHuman(new Date("2026-10-20T22:00:00Z"), LA, { zoneLabel: true }), "Tuesday, October 20, 2026 at 3:00 PM PDT");
  // After the clock change (Nov 1), the same wall-clock time is PST.
  assert.equal(formatHuman(new Date("2026-11-10T23:00:00Z"), LA, { zoneLabel: true }), "Tuesday, November 10, 2026 at 3:00 PM PST");
});

test("upcoming days: today, tomorrow, and no duplicate date across the clock change", () => {
  // Late evening of Oct 31 local: tomorrow (Nov 1) is the 25-hour day.
  const now = new Date("2026-11-01T06:30:00Z"); // Oct 31, 11:30 PM PDT
  const days = upcomingDays(now, LA, 4);
  assert.deepEqual(days, [
    "Saturday 2026-10-31 (today)",
    "Sunday 2026-11-01 (tomorrow)",
    "Monday 2026-11-02",
    "Tuesday 2026-11-03",
  ]);
});
