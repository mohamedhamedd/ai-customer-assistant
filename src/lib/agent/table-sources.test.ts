import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyRow, type ServiceRow } from "@/lib/admin/service-rows";
import { tableSources } from "./table-sources";

const row = (name: string, price = "", duration = ""): ServiceRow => ({ ...emptyRow(), name, price, duration });
const services = [
  row("Porcelain crown", "$1,100"),
  row("Root canal (molar)", "$1,250", "90 minutes"),
  row("In-office teeth whitening (single session)", "$349", "60 to 90 minutes"),
  row("Take-home whitening kit (custom trays and gel)", "$199"),
  row("Whitening touch-up gel (refill)", "$45"),
  row("Group class trial", "Free"),
];
const week = {
  hours: [...[1, 2, 3, 4].map((day) => ({ day, opens: "08:00", closes: "17:00" })), { day: 5, opens: "08:00", closes: "14:00" }],
  lastStartBeforeClose: 60,
};
const tables = { services, week };
const chips = (answer: string) => tableSources(answer, tables).map((s) => s.title);
const servicesIn = (answer: string) => tableSources(answer, tables).find((s) => s.table === "services")?.excerpt ?? "";

// The answers below are the ones the assistant gave in the live check.
test("a price or a list from the services table gets a Services chip with the rows it quoted", () => {
  assert.deepEqual(chips("A porcelain crown at Lakeside Dental Clinic costs $1,100."), ["Services"]);
  assert.equal(servicesIn("A porcelain crown at Lakeside Dental Clinic costs $1,100."), "| Service | Price | Duration |\n|---|---|---|\n| Porcelain crown | $1,100 | – |");

  const whitening = "- In-office teeth whitening (single session) costs $349 and takes 60 to 90 minutes.\n- The take-home kit costs $199.";
  const excerpt = servicesIn(whitening);
  assert.ok(excerpt.includes("| In-office teeth whitening (single session) | $349 | 60 to 90 minutes |"));
  assert.ok(excerpt.includes("| Take-home whitening kit (custom trays and gel) | $199 | – |"), "a figure next to one of its main words");
  assert.ok(!excerpt.includes("touch-up gel"), "not every whitening row");
  assert.deepEqual(chips("Our services:\n- Porcelain crown\n- Root canal (molar)\n- Group class trial"), ["Services"]);
});

test("no Services chip for a mention without its exact name or figure, or a figure inside a longer one", () => {
  assert.deepEqual(chips("A root canal usually takes one or two visits, and nitrous oxide is available."), [], "from the documents");
  assert.deepEqual(chips("Whitening gel refills start at $450 for the set."), [], "$45 is not $450");
  assert.deepEqual(chips("The touch-up gel is $45."), ["Services"], "but $45 is");
  assert.deepEqual(chips("A trial class is free."), [], "a price without a digit proves nothing");
  assert.deepEqual(chips("The group class trial is free."), ["Services"], "the exact name does");
});

test("opening hours: a time the business opens or closes, in talk about hours", () => {
  assert.deepEqual(chips("On Friday, Lakeside Dental Clinic closes at 2:00 PM. The last appointment starts 1 hour before closing."), ["Opening hours"]);
  assert.deepEqual(chips("We're open 8am to 5pm Monday to Thursday."), ["Opening hours"]);
  const hours = tableSources("We close at 2 p.m. on Fridays.", tables)[0];
  assert.ok(hours.excerpt.startsWith("- Monday: 8:00 AM to 5:00 PM\n") && hours.excerpt.endsWith("The last appointment starts 1 hour before closing."));
  assert.deepEqual(chips("Just to confirm: Thursday, October 15 at 4:00 PM. Is that right?"), [], "a read-back's time isn't the hours");
  assert.deepEqual(chips("The appointment takes about 2 hours."), []);
});

test("both, services first; nothing without tables", () => {
  assert.deepEqual(chips("A porcelain crown is $1,100, and we're open Friday until 2:00 PM."), ["Services", "Opening hours"]);
  assert.deepEqual(tableSources("A porcelain crown is $1,100.", { services: [], week: { hours: [], lastStartBeforeClose: 0 } }), []);
});
