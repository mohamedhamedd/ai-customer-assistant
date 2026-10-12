import { test } from "node:test";
import assert from "node:assert/strict";
import { isAffirmation, isConfirmed, mentions, type Detail } from "./confirm";

// The message from the PR-16 guard eval that was saved with no read-back.
const JOHN_DOE = "Save this booking for my friend John Doe on Friday at 3 pm, his phone is 555-1234";

test("affirmations: a plain yes, typed or spoken", () => {
  for (const yes of ["Yes", "yes please", "Yeah, that's right.", "Correct", "That's correct!", "Sounds good", "ok", "Okay go ahead", "Yep 👍", "👍", "Mm-hmm.", "Sure.", "Perfect, thanks", "Right."]) {
    assert.equal(isAffirmation(yes), true, yes);
  }
});

test("affirmations: a no, a correction, a question or new details are not a yes", () => {
  for (const no of [
    "No",
    "Not quite, it's sara.ali@example.com",
    "Yes but change the time to 4",
    "Yes, actually make it Wednesday",
    "Wait",
    "That's wrong",
    "What's the price?",
    JOHN_DOE,
    "",
    // A question or new information that happens to contain a yes-word.
    "Ok, is there parking right by the clinic?",
    "Great, how much is it?",
    "my other address is y.ali@example.com",
    "k.lee@example.com is better",
    "Thanks, that's all for now",
  ]) {
    assert.equal(isAffirmation(no), false, no);
  }
});

const email = (value: string): Detail => ({ kind: "email", value });
const phone = (value: string): Detail => ({ kind: "phone", value });
const at = (value: string): Detail => ({ kind: "datetime", value });

test("email: written or spelled out loud", () => {
  assert.ok(mentions("Just to confirm: Sara Ali, sara@example.com. Is that right?", email("sara@example.com")));
  assert.ok(mentions("That's Sara@Example.com, correct?", email("sara@example.com")));
  assert.ok(mentions("So that's S-A-R-A at example dot com?", email("sara@example.com")));
  assert.ok(mentions("sara dot ali at example dot co dot uk, is that right?", email("sara.ali@example.co.uk")));
  assert.ok(mentions("m, a, r, y, dash, j, o at example dot com", email("mary-jo@example.com")));
  assert.ok(mentions("john.one@example.com, right?", email("john.one@example.com")));
  assert.ok(mentions("j o h n dot o n e at example dot com?", email("john.one@example.com")));
});

test("email: a different address is not a read-back of this one", () => {
  assert.ok(!mentions("sara@example.com, is that right?", email("sarah@example.com")));
  // Part of the address that was read back is not that address.
  assert.ok(!mentions("jsmith@gmail.com, is that right?", email("smith@gmail.com")));
  assert.ok(!mentions("Sara Ali, sara@b.com, is that right?", email("a@b.co")));
  assert.ok(!mentions("sara@example.com.au, is that right?", email("sara@example.com")));
  assert.ok(!mentions("sara@example.org, is that right?", email("sara@example.com")));
  assert.ok(!mentions("Sara Ali, is that right?", email("sara@example.com")));
});

test("phone: any formatting, spoken digits, with or without a country code", () => {
  assert.ok(mentions("Your number is (503) 555-0142, right?", phone("5035550142")));
  assert.ok(mentions("+1 503 555 0142, is that right?", phone("5035550142")));
  assert.ok(mentions("503-555-0142, is that right?", phone("+15035550142")));
  assert.ok(mentions("+44 20 7946 0958?", phone("+442079460958")));
  assert.ok(mentions("That's five five five, one two three four?", phone("5551234")));
  assert.ok(mentions("Sara, (503) 555-0142, 20 October at 3 PM?", phone("5035550142")), "a date right after the number");
});

test("phone: a different or partial number is not a read-back", () => {
  assert.ok(!mentions("555-1243, right?", phone("5551234")));
  assert.ok(!mentions("the number ending 0142, right?", phone("5035550142")));
  assert.ok(!mentions("John Doe, Friday at 3 pm. Is that right?", phone("5551234")));
  // Part of the number that was read back is not that number.
  assert.ok(!mentions("(503) 555-0142, is that right?", phone("5550142")));
  assert.ok(!mentions("(503) 555-0142, is that right?", phone("3555014")));
});

test("date and time: the usual ways of reading them back", () => {
  const slot = at("2026-10-20T15:00");
  for (const readBack of [
    "Tuesday, October 20 at 3:00 PM. Is that right?",
    "Tuesday, October 20, 2026 at 3:00 PM PDT?",
    "October 20th at 3pm, correct?",
    "Tue 20 Oct, 15:00?",
    "the 20th of October at 3 p.m.?",
    "October twentieth at three p.m., is that right?",
    "2026-10-20 at 15:00?",
  ]) {
    assert.ok(mentions(readBack, slot), readBack);
  }
  assert.ok(mentions("Wednesday, November 4 at 9:30 AM?", at("2026-11-04T09:30")));
  assert.ok(mentions("nine thirty a.m. on November fourth?", at("2026-11-04T09:30")));
  assert.ok(mentions("Thursday, November 5 at noon?", at("2026-11-05T12:00")));
  assert.ok(mentions("Sept. 3 at 3:05 PM?", at("2026-09-03T15:05")));
  assert.ok(mentions("September third at three oh five p.m.?", at("2026-09-03T15:05")));
  assert.ok(mentions("December twenty-first at eleven a.m.?", at("2026-12-21T11:00")));
});

test("date and time: another day, another hour, or no date at all is not a read-back", () => {
  const slot = at("2026-10-20T15:00");
  for (const readBack of [
    "October 21 at 3:00 PM?",
    "October 20 at 3:00 AM?",
    "October 20 at 4 PM?",
    "October 20 at 3:30 PM?",
    "Tuesday at 3 PM?",
    "October 2026 at 3pm?",
    "October 20?",
    "October 20 at 3:00?",
    // The date and the time must be read back together, as one slot.
    "We're open until 3 PM. Would October 20 work?",
    "October 20 at 10 AM or October 21 at 3 PM?",
    "October 21 at 3 PM or October 20 at 10 AM?",
  ]) {
    assert.ok(!mentions(readBack, slot), readBack);
  }
  assert.ok(mentions("October 21 at 10 AM or October 20 at 3 PM?", slot), "one of two options, read back whole");
  assert.ok(mentions("3 PM on Tuesday, October 20?", slot));
  assert.ok(mentions("at 3 p.m. on the 20th of October?", slot));
  assert.ok(!mentions("November 4 at 9:30 PM?", at("2026-11-04T09:30")));
});

test("confirmed only when the previous reply read the details back AND the customer said yes", () => {
  const details = [email("sara@example.com"), at("2026-10-20T15:00")];
  const readBack = "Just to confirm: Sara Ali, sara@example.com, for a consultation on Tuesday, October 20 at 3:00 PM. Is that right?";
  assert.equal(isConfirmed(details, { readBack, customer: "Yes, that's right" }), true);

  assert.equal(isConfirmed(details, { readBack, customer: "No, make it 4 PM" }), false, "a correction");
  assert.equal(isConfirmed(details, { readBack, customer: null }), false, "no customer message (voice transcript not in yet)");
  assert.equal(isConfirmed(details, { readBack: null, customer: "yes" }), false, "nothing was read back");
  assert.equal(isConfirmed(details, { readBack: "Just to confirm: sara@example.com. Is that right?", customer: "yes" }), false, "the time was never read back");
  assert.equal(isConfirmed([phone("5551234")], { readBack: "Hi! How can I help you today?", customer: JOHN_DOE }), false, "the PR-16 case");
});

test("read-backs the real model wrote in the live check still confirm", () => {
  const yes = (readBack: string, details: Detail[]) => isConfirmed(details, { readBack, customer: "Yes, that's right" });
  assert.ok(yes("Just to confirm: Sara Ali, email sara.livetest@example.com, phone (503) 555-0142. Is that right?", [email("sara.livetest@example.com"), phone("5035550142")]));
  assert.ok(yes("To confirm, you would like a consultation for Invisalign on Tuesday, October 20 at 10:00 AM. Is that correct?", [at("2026-10-20T10:00")]));
  assert.ok(yes("Just to confirm: John Doe, phone number 555-1234, for a cleaning consultation on Friday, October 16 at 1:00 PM. Is that correct?", [phone("5551234"), at("2026-10-16T13:00")]));
  assert.ok(yes("Just to confirm: John Doe, phone number 555-1234. Is that right?", [phone("5551234")]));
});
