import { test } from "node:test";
import assert from "node:assert/strict";
import { describeHours, startCheck, formatMinutes, formatTime, validateHours, validateWeek, type HoursRow } from "./hours-rows";

// Mon-Fri 8-12 and 1-5, Saturday 9-1, Friday night until midnight, Sunday closed.
const week: HoursRow[] = [
  ...[1, 2, 3, 4, 5].flatMap((day) => [
    { day, opens: "08:00", closes: "12:00" },
    { day, opens: "13:00", closes: "17:00" },
  ]),
  { day: 5, opens: "19:00", closes: "00:00" },
  { day: 6, opens: "09:00", closes: "13:00" },
];

test("a valid week passes, sorted by day and time", () => {
  const result = validateHours([{ day: 6, opens: "09:00", closes: "13:00" }, { day: 1, opens: "13:00", closes: "17:00" }, { day: 1, opens: "08:00", closes: "12:00" }]);
  assert.deepEqual(result, { ok: true, rows: [{ day: 1, opens: "08:00", closes: "12:00" }, { day: 1, opens: "13:00", closes: "17:00" }, { day: 6, opens: "09:00", closes: "13:00" }] });
  assert.ok(validateHours(week).ok);
  assert.deepEqual(validateHours([]), { ok: true, rows: [] }, "closed every day is a valid answer");
});

test("each bad range gets its own message, by its place in the list", () => {
  const result = validateHours([
    { day: 1, opens: "09:00", closes: "17:00" },
    { day: 1, opens: "12:00", closes: "13:00" },
    { day: 2, opens: "17:00", closes: "09:00" },
    { day: 3, opens: "9am", closes: "17:00" },
    { day: 8, opens: "09:00", closes: "17:00" },
  ]);
  assert.ok(!result.ok);
  assert.deepEqual(result.errors, [
    { row: 1, message: "Overlaps other hours that day." },
    { row: 2, message: "Closing must be after opening." },
    { row: 3, message: "Enter the opening time." },
    { row: 4, message: "Choose a day of the week." },
  ]);
  const five = Array.from({ length: 5 }, (_, i) => ({ day: 1, opens: `0${i}:00`, closes: `0${i}:30` }));
  assert.deepEqual(validateHours(five), { ok: false, error: "Some hours need fixing.", errors: [{ row: 4, message: "At most 4 time ranges a day." }] });
  assert.equal(validateHours("Mon-Fri 9-5").ok, false);
});

test("the week in words, one line a day", () => {
  assert.equal(formatTime("00:00"), "12:00 AM");
  assert.equal(formatTime("00:00", true), "midnight");
  assert.equal(formatTime("12:30"), "12:30 PM");
  assert.deepEqual(describeHours(week), [
    "Monday: 8:00 AM to 12:00 PM and 1:00 PM to 5:00 PM",
    "Tuesday: 8:00 AM to 12:00 PM and 1:00 PM to 5:00 PM",
    "Wednesday: 8:00 AM to 12:00 PM and 1:00 PM to 5:00 PM",
    "Thursday: 8:00 AM to 12:00 PM and 1:00 PM to 5:00 PM",
    "Friday: 8:00 AM to 12:00 PM and 1:00 PM to 5:00 PM and 7:00 PM to midnight",
    "Saturday: 9:00 AM to 1:00 PM",
    "Sunday: closed",
  ]);
});

test("the week with its last-start setting", () => {
  assert.deepEqual(validateWeek({ hours: [], lastStartBeforeClose: 60 }), { ok: true, week: { hours: [], lastStartBeforeClose: 60 } });
  assert.deepEqual(validateWeek({ hours: [] }), { ok: true, week: { hours: [], lastStartBeforeClose: 0 } });
  assert.deepEqual(validateWeek({ hours: [], lastStartBeforeClose: 300 }), { ok: false, error: "Choose when the last appointment starts.", errors: [] });
  assert.deepEqual([45, 60, 90, 120].map(formatMinutes), ["45 minutes", "1 hour", "1 hour 30 minutes", "2 hours"]);
});

test("an appointment can start: by weekday, from the opening minute up to (not at) closing", () => {
  const openAt = (rows: HoursRow[], local: string) => {
    const check = startCheck({ hours: rows, lastStartBeforeClose: 0 }, local);
    return check && check.ok;
  };
  // 2026-10-19 is a Monday.
  assert.equal(openAt(week, "2026-10-19T08:00"), true);
  assert.equal(openAt(week, "2026-10-19T11:59"), true);
  assert.equal(openAt(week, "2026-10-19T12:00"), false, "lunch");
  assert.equal(openAt(week, "2026-10-19T17:00"), false, "closing time");
  assert.equal(openAt(week, "2026-10-19T07:30"), false);
  assert.equal(openAt(week, "2026-10-23T23:30"), true, "Friday until midnight");
  assert.equal(openAt(week, "2026-10-24T10:00"), true, "Saturday");
  assert.equal(openAt(week, "2026-10-25T10:00"), false, "Sunday");
  assert.equal(openAt(week, "Tuesday 3pm"), null);
});

test("the last appointment starts the set time before closing, for each range, and too late says when", () => {
  const lastHour = { hours: week, lastStartBeforeClose: 60 };
  // Seen live: "one hour before closing" at 5 PM was read as before 4 PM.
  assert.deepEqual(startCheck(lastHour, "2026-10-19T16:00"), { ok: true });
  assert.deepEqual(startCheck(lastHour, "2026-10-19T16:30"), { ok: false, reason: "too_late", latest: "16:00" });
  assert.deepEqual(startCheck(lastHour, "2026-10-19T11:30"), { ok: false, reason: "too_late", latest: "11:00" }, "ends by the lunch break");
  assert.deepEqual(startCheck(lastHour, "2026-10-23T23:00"), { ok: true }, "an hour before midnight");
  assert.deepEqual(startCheck(lastHour, "2026-10-23T23:30"), { ok: false, reason: "too_late", latest: "23:00" });
  assert.deepEqual(startCheck(lastHour, "2026-10-25T10:00"), { ok: false, reason: "closed" });
  assert.deepEqual(startCheck({ hours: [{ day: 1, opens: "09:00", closes: "09:30" }], lastStartBeforeClose: 60 }, "2026-10-19T09:00"), { ok: true }, "a short range: from its opening");
});
