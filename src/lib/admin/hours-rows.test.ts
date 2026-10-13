import { test } from "node:test";
import assert from "node:assert/strict";
import { describeHours, formatClosedDate, formatMinutes, formatTime, startCheck, upcomingClosed, validateHours, validateWeek, weekOfMonth, type HoursRow } from "./hours-rows";

// Mon-Fri 8-12 and 1-5, Saturday 9-1, Friday night until midnight, Sunday closed.
const week: HoursRow[] = [
  ...[1, 2, 3, 4, 5].flatMap((day) => [
    { day, opens: "08:00", closes: "12:00", weeks: [] },
    { day, opens: "13:00", closes: "17:00", weeks: [] },
  ]),
  { day: 5, opens: "19:00", closes: "00:00", weeks: [] },
  { day: 6, opens: "09:00", closes: "13:00", weeks: [] },
];

test("a valid week passes, sorted by day and time", () => {
  const result = validateHours([{ day: 6, opens: "09:00", closes: "13:00" }, { day: 1, opens: "13:00", closes: "17:00" }, { day: 1, opens: "08:00", closes: "12:00" }]);
  assert.deepEqual(result, {
    ok: true,
    rows: [
      { day: 1, opens: "08:00", closes: "12:00", weeks: [] },
      { day: 1, opens: "13:00", closes: "17:00", weeks: [] },
      { day: 6, opens: "09:00", closes: "13:00", weeks: [] },
    ],
  });
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
  assert.deepEqual(validateWeek({ hours: [], lastStartBeforeClose: 60, notes: "  Saturdays: first and third only. " }), {
    ok: true,
    week: { hours: [], lastStartBeforeClose: 60, notes: "Saturdays: first and third only.", closed: [] },
  });
  assert.deepEqual(validateWeek({ hours: [] }), { ok: true, week: { hours: [], lastStartBeforeClose: 0, notes: "", closed: [] } });
  assert.deepEqual(validateWeek({ hours: [], notes: "x".repeat(501) }), { ok: false, error: "Keep the notes under 500 characters.", errors: [] });
  assert.deepEqual(validateWeek({ hours: [], lastStartBeforeClose: 300 }), { ok: false, error: "Choose when the last appointment starts.", errors: [] });
  assert.deepEqual([45, 60, 90, 120].map(formatMinutes), ["45 minutes", "1 hour", "1 hour 30 minutes", "2 hours"]);
});

test("an appointment can start: by weekday, from the opening minute up to (not at) closing", () => {
  const openAt = (rows: HoursRow[], local: string) => {
    const check = startCheck({ hours: rows, lastStartBeforeClose: 0, notes: "", closed: [] }, local);
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
  const lastHour = { hours: week, lastStartBeforeClose: 60, notes: "", closed: [] };
  // Seen live: "one hour before closing" at 5 PM was read as before 4 PM.
  assert.deepEqual(startCheck(lastHour, "2026-10-19T16:00"), { ok: true });
  assert.deepEqual(startCheck(lastHour, "2026-10-19T16:30"), { ok: false, reason: "too_late", latest: "16:00" });
  assert.deepEqual(startCheck(lastHour, "2026-10-19T11:30"), { ok: false, reason: "too_late", latest: "11:00" }, "ends by the lunch break");
  assert.deepEqual(startCheck(lastHour, "2026-10-23T23:00"), { ok: true }, "an hour before midnight");
  assert.deepEqual(startCheck(lastHour, "2026-10-23T23:30"), { ok: false, reason: "too_late", latest: "23:00" });
  assert.deepEqual(startCheck(lastHour, "2026-10-25T10:00"), { ok: false, reason: "closed" });
  assert.deepEqual(startCheck({ hours: [{ day: 1, opens: "09:00", closes: "09:30", weeks: [] }], lastStartBeforeClose: 60, notes: "", closed: [] }, "2026-10-19T09:00"), { ok: true }, "a short range: from its opening");
});

// ---------------------------------------------------------------------------
// Some weeks of the month, and closed dates
// ---------------------------------------------------------------------------

// Lakeside: Saturdays 9 to 1, 1st and 3rd only; closed on Thanksgiving.
const lakeside = {
  hours: [
    { day: 4, opens: "08:00", closes: "17:00", weeks: [] },
    { day: 6, opens: "09:00", closes: "13:00", weeks: [1, 3] },
  ],
  lastStartBeforeClose: 60,
  notes: "",
  closed: [{ date: "2026-11-26", label: "Thanksgiving" }],
};

test("which weeks: validated, sorted, all five is every week; ranges on different weeks may overlap", () => {
  assert.deepEqual(validateHours([{ day: 6, opens: "09:00", closes: "13:00", weeks: [3, -1, 1, 3] }]), { ok: true, rows: [{ day: 6, opens: "09:00", closes: "13:00", weeks: [1, 3, -1] }] });
  assert.deepEqual(validateHours([{ day: 6, opens: "09:00", closes: "13:00", weeks: [1, 2, 3, 4, 5] }]), { ok: true, rows: [{ day: 6, opens: "09:00", closes: "13:00", weeks: [] }] });
  assert.equal(validateHours([{ day: 6, opens: "09:00", closes: "13:00", weeks: [6] }]).ok, false);
  const alternate = [
    { day: 6, opens: "09:00", closes: "13:00", weeks: [1, 3] },
    { day: 6, opens: "10:00", closes: "14:00", weeks: [2, 4] },
  ];
  assert.ok(validateHours(alternate).ok, "1st and 3rd 9 to 1, 2nd and 4th 10 to 2");
  assert.deepEqual(validateHours([alternate[0], { ...alternate[1], weeks: [3] }]), { ok: false, error: "Some hours need fixing.", errors: [{ row: 1, message: "Overlaps other hours that day." }] });
  assert.deepEqual(validateHours([alternate[0], { ...alternate[1], weeks: [] }]).ok, false, "every week includes the 1st");
});

test("closed dates: real dates, once each, sorted; errors say which row", () => {
  assert.deepEqual(validateWeek({ hours: [], closed: [{ date: "2026-12-25", label: " Christmas Day " }, { date: "2026-11-26", label: "" }] }), {
    ok: true,
    week: { hours: [], lastStartBeforeClose: 0, notes: "", closed: [{ date: "2026-11-26", label: "" }, { date: "2026-12-25", label: "Christmas Day" }] },
  });
  const bad = validateWeek({ hours: [], closed: [{ date: "2026-02-30", label: "" }, { date: "2026-12-25", label: "" }, { date: "2026-12-25", label: "again" }] });
  assert.deepEqual(bad, {
    ok: false,
    error: "Some closed dates need fixing.",
    errors: [
      { row: 0, message: "Enter a date.", list: "closed" },
      { row: 2, message: "Already listed.", list: "closed" },
    ],
  });
  assert.equal(formatClosedDate({ date: "2026-12-25", label: "Christmas Day" }), "Friday, December 25, 2026 (Christmas Day)");
  assert.deepEqual(upcomingClosed([{ date: "2026-10-01", label: "" }, ...lakeside.closed], "2026-10-13"), lakeside.closed, "past ones left out");
});

test("in words: the weeks a range applies to", () => {
  assert.equal(describeHours(lakeside.hours)[5], "Saturday: 9:00 AM to 1:00 PM (1st and 3rd Saturday of the month only)");
  assert.equal(describeHours([{ day: 5, opens: "08:00", closes: "12:00", weeks: [-1] }])[4], "Friday: 8:00 AM to 12:00 PM (last Friday of the month only)");
});

test("an appointment can start only on the weeks a range applies to, and never on a closed date", () => {
  assert.deepEqual(weekOfMonth(2026, 10, 24), { nth: 4, last: false });
  assert.deepEqual(weekOfMonth(2026, 10, 31), { nth: 5, last: true });
  // Seen live: a request for the 4th Saturday was read back.
  assert.deepEqual(startCheck(lakeside, "2026-10-24T10:00"), { ok: false, reason: "closed" }, "the 4th Saturday");
  assert.deepEqual(startCheck(lakeside, "2026-10-17T10:00"), { ok: true }, "the 3rd Saturday");
  assert.deepEqual(startCheck(lakeside, "2026-11-07T10:00"), { ok: true }, "the 1st Saturday of November");
  assert.deepEqual(startCheck(lakeside, "2026-11-26T10:00"), { ok: false, reason: "closed_date", label: "Thanksgiving" }, "a Thursday, but closed");
  assert.deepEqual(startCheck(lakeside, "2026-11-19T10:00"), { ok: true }, "the Thursday before");
  const lastFriday = { ...lakeside, hours: [{ day: 5, opens: "08:00", closes: "12:00", weeks: [-1] }], closed: [] };
  assert.deepEqual(startCheck(lastFriday, "2026-10-30T09:00"), { ok: true }, "the last Friday of October");
  assert.deepEqual(startCheck(lastFriday, "2026-10-23T09:00"), { ok: false, reason: "closed" });
  assert.deepEqual(startCheck({ ...lakeside, hours: [] }, "2026-11-26T10:00"), { ok: false, reason: "closed_date", label: "Thanksgiving" }, "closed dates without weekly hours");
  assert.deepEqual(startCheck({ ...lakeside, hours: [] }, "2026-11-25T10:00"), { ok: true });
});
