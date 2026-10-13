// Integration tests: a business's opening hours, against the local database,
// and the consultation tool's time check reading them. Run with
// `npm run test:integration`.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/supabase";
import { executeTool } from "@/lib/agent/execute";
import { formatLocal } from "@/lib/agent/time";
import { listHours, OpeningHoursError, saveHours } from "./hours";

const businesses: string[] = [];
after(async () => {
  await db().from("businesses").delete().in("id", businesses);
});

const TZ = "America/Chicago";

async function business() {
  const { data, error } = await db().from("businesses").insert({ slug: `itest-${randomUUID().slice(0, 8)}`, name: "Itest Gym", timezone: TZ }).select("id").single();
  assert.ifError(error);
  businesses.push(data!.id);
  return data!.id;
}

const weekdays = [1, 2, 3, 4, 5].map((day) => ({ day, opens: "09:00", closes: "17:00" }));
const week = (hours: typeof weekdays, lastStartBeforeClose = 0, notes = "") => ({ hours, lastStartBeforeClose, notes });

test("the week is saved sorted, replaced as a whole, and kept per business", async () => {
  const mine = await business();
  const theirs = await business();
  await saveHours(theirs, week(weekdays));

  const saturday = { day: 6, opens: "10:00", closes: "00:00" };
  assert.deepEqual(
    await saveHours(mine, week([saturday, ...weekdays], 60, " Closed on public holidays. ")),
    week([...weekdays, saturday], 60, "Closed on public holidays."),
    "midnight closing kept as 00:00; the notes trimmed",
  );
  assert.deepEqual(await saveHours(mine, week([saturday])), week([saturday]), "replaced, not added to");
  assert.deepEqual(await listHours(theirs), week(weekdays), "another business's hours are untouched");
});

test("a week with problems is refused with each one on its range, and nothing changes; the database refuses a backwards range itself", async () => {
  const mine = await business();
  await saveHours(mine, week(weekdays));
  await assert.rejects(
    saveHours(mine, week([{ day: 1, opens: "09:00", closes: "12:00" }, { day: 1, opens: "11:00", closes: "13:00" }], 30)),
    (err: unknown) => err instanceof OpeningHoursError && err.status === 400 && JSON.stringify(err.rows) === JSON.stringify([{ row: 1, message: "Overlaps other hours that day." }]),
  );
  assert.deepEqual(await listHours(mine), week(weekdays), "the setting too");
  const { error } = await db().from("opening_hours").insert({ business_id: mine, day: 1, opens: "17:00", closes: "09:00" });
  assert.ok(error, "closes before opens");
});

test("a consultation request for a time no appointment can start is refused with the hours", async () => {
  const id = await business();
  await saveHours(id, week(weekdays, 60));
  const { data: convo } = await db().from("conversations").insert({ business_id: id, session_id: randomUUID() }).select("id").single();
  const ctx = { businessId: id, conversationId: convo!.id, channel: "text" as const, timeZone: TZ, now: () => new Date() };
  // The next Sunday, and the Monday after it.
  const day = (weekday: number) => {
    const at = new Date(Date.now() + 2 * 86_400_000);
    while (new Date(`${formatLocal(at, TZ).slice(0, 10)}T12:00:00Z`).getUTCDay() !== weekday) at.setTime(at.getTime() + 86_400_000);
    return formatLocal(at, TZ).slice(0, 10);
  };
  const request = async (local: string) =>
    (await executeTool("create_consultation_request", JSON.stringify({ service: "personal training", preferred_datetime: local }), ctx, { log: () => {}, trace: () => {} })).output;

  const sunday = await request(`${day(0)}T10:00`);
  assert.ok(!sunday.ok && sunday.error === "outside_opening_hours");
  assert.equal(sunday.hours?.[6], "Sunday: closed");
  assert.equal((await request(`${day(1)}T16:30`)).error, "outside_opening_hours", "after the last start on Monday");
  assert.equal((await request(`${day(1)}T16:00`)).error, "confirm_first", "the last start itself");
  assert.equal((await request(`${day(1)}T10:00`)).error, "confirm_first", "open on Monday");
});
