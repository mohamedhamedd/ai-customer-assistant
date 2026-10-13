import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseService, namedIn, words, type ServiceEvidence } from "./service-choice";

// A dental clinic's table, as staff would list it.
const NAMES = [
  "Routine check-up and cleaning",
  "Emergency exam (same-day)",
  "Porcelain crown",
  "Root canal (front tooth)",
  "Root canal (molar)",
  "In-office teeth whitening (single session)",
  "Take-home whitening kit (custom trays and gel)",
  "Porcelain veneer (per tooth)",
  "Traditional braces (full treatment)",
];
const services = [...NAMES.map((name) => ({ name, requestable: true })), { name: "Whitening touch-up gel (refill)", requestable: false }];
const evidence = (customerSaid: string[], offered: string[] = []): ServiceEvidence => ({ services, customerSaid, offered });

test("words: lower case, no filler, short words, numbers, emails or links", () => {
  assert.deepEqual(words("I'd like to book a whitening consultation on Tuesday at 3pm, please"), ["whitening"]);
  assert.deepEqual(words("In-office teeth whitening (single session)"), ["office", "teeth", "whitening", "single"]);
  assert.deepEqual(words("Sam, sam.exam@example.com, see https://example.com/exam"), ["sam"]);
});

test("a text names a service only when nothing else fits as well", () => {
  const only = (text: string) => {
    const { named } = namedIn(text, NAMES);
    return named.length === 1 ? named[0] : named.length === 0 ? null : named;
  };
  assert.equal(only("do you do braces?"), "Traditional braces (full treatment)");
  assert.equal(only("two crowns"), "Porcelain crown");
  assert.equal(only("a porcelain crown"), "Porcelain crown", "more words in common than the veneer, and all its main words");
  assert.equal(only("a root canal on my molar"), "Root canal (molar)");
  assert.equal(only("the take-home kit"), "Take-home whitening kit (custom trays and gel)");
  assert.equal(only("whitening"), null);
  assert.equal(only("I want whiter teeth"), null, "teeth doesn't settle it: the in-office name has a main word they didn't say");
  assert.equal(only("a root canal"), null);
  assert.equal(only("an example"), null, "example is not exam");
  assert.deepEqual(namedIn("teeth whitening", NAMES).matched, ["In-office teeth whitening (single session)", "Take-home whitening kit (custom trays and gel)"]);
  assert.deepEqual(namedIn("gum surgery", NAMES), { matched: [], named: [] });
  // Seen live: the cleaning had more words in common, so the crown wasn't named.
  assert.deepEqual(only("a porcelain crown Thursday 10am and a routine check-up and cleaning Friday 9am"), ["Routine check-up and cleaning", "Porcelain crown"]);
  // Two different services in full are both named, sharing a word or not: the
  // model sends what the customer meant, and the read-back says it back.
  assert.deepEqual(only("a porcelain crown and a porcelain veneer"), ["Porcelain crown", "Porcelain veneer (per tooth)"]);
  // Seen live: "style" in both made neither the customer's.
  const salon = ["Women's cut and style", "Men's cut", "Blow-dry and style", "Full colour", "Colour consultation (15 minutes)"];
  assert.deepEqual(namedIn("Women's cut and style, full colour and a blow-dry and style on Saturday", salon).named, ["Women's cut and style", "Blow-dry and style", "Full colour"]);
  // A consultation by name: the one service that is a consultation.
  const invisalign = ["Invisalign or orthodontic consultation (20 minutes)", "Invisalign (full treatment)"];
  assert.deepEqual(namedIn("Invisalign consultation this Sunday at 11am", invisalign).named, [invisalign[0]]);
  assert.deepEqual(namedIn("I want Invisalign", invisalign).named, [invisalign[1]], "without the word: the treatment, all of whose name they said");
  assert.deepEqual(namedIn("a colour consultation", salon).named, ["Colour consultation (15 minutes)"]);
  assert.deepEqual(namedIn("a colour consultation and a full colour", salon).named, ["Full colour", "Colour consultation (15 minutes)"]);
  // Seen live: the exact name tied with "(two or more surfaces)" on "surface".
  const fillings = ["Composite filling (one surface)", "Composite filling (two or more surfaces)", "Fluoride treatment"];
  assert.equal(namedIn("a composite filling (one surface) tomorrow at 9am", fillings).named.join(), "Composite filling (one surface)");
  assert.deepEqual(namedIn("a composite filling", fillings).named, [], "which one is still theirs to say");
  assert.deepEqual(namedIn("fluoride treatment", [...fillings, "Traditional braces (full treatment)"]).matched, ["Fluoride treatment"], "treatment is filler, like consultation");
});

test("one service the customer named: its exact name, whatever the model wrote", () => {
  // Seen live: the email's "example" matched the exam services.
  assert.deepEqual(chooseService("braces", evidence(["I'm Sam Lee, sam.itest1@example.com. I'd like a consultation for braces next Tuesday at 3pm"])), {
    kind: "ok",
    service: "Traditional braces (full treatment)",
  });
  assert.deepEqual(chooseService("traditional braces (FULL treatment)", evidence(["braces please"])), { kind: "ok", service: "Traditional braces (full treatment)" });
});

test("several fit: the customer must choose, even when the model already picked one", () => {
  const options = ["In-office teeth whitening (single session)", "Take-home whitening kit (custom trays and gel)"];
  assert.deepEqual(chooseService("whitening", evidence(["I'd like whitening on Tuesday"])), { kind: "choose", options });
  assert.deepEqual(chooseService("In-office teeth whitening (single session)", evidence(["I'd like whitening on Tuesday"])), { kind: "choose", options }, "the model can't choose for them");
  assert.deepEqual(chooseService("root canal", evidence(["I need a root canal"])), { kind: "choose", options: ["Root canal (front tooth)", "Root canal (molar)"] });
  // Seen live: "teeth" in one of the names made the model's pick look like the customer's.
  assert.deepEqual(chooseService("Teeth Whitening", evidence(["Can I book teeth whitening next Tuesday at 3pm?"])), { kind: "choose", options });
});

test("two services in one message: each is the customer's", () => {
  const said = ["I'm Dan, 5550303008. Book a porcelain crown Thursday 10am and a routine check-up and cleaning Friday 9am"];
  assert.deepEqual(chooseService("Porcelain crown", evidence(said)), { kind: "ok", service: "Porcelain crown" });
  assert.deepEqual(chooseService("Routine check-up and cleaning", evidence(said)), { kind: "ok", service: "Routine check-up and cleaning" });
});

test("after the options were offered, the customer's answer picks one of them, in any words", () => {
  const options = ["In-office teeth whitening (single session)", "Take-home whitening kit (custom trays and gel)"];
  const said = ["I'd like whitening on Tuesday", "the first one"];
  assert.deepEqual(chooseService("In-office teeth whitening (single session)", evidence(said, options)), { kind: "ok", service: options[0] });
  assert.deepEqual(chooseService("Take-home whitening kit (custom trays and gel)", evidence(["whitening", "the kit"])), { kind: "ok", service: options[1] }, "or names it");
  assert.deepEqual(chooseService("Porcelain crown", evidence(said, options)), { kind: "choose", options: ["Porcelain crown", ...options] }, "not one they were offered");
});

test("nothing the customer said names a service: the model's pick is offered, for the customer to say yes to", () => {
  const braces = "Traditional braces (full treatment)";
  assert.deepEqual(chooseService(braces, evidence(["Can you fix my overbite?"])), { kind: "choose", options: [braces] });
  assert.deepEqual(chooseService(braces, evidence(["Can you fix my overbite?", "yes"], [braces])), { kind: "ok", service: braces }, "once they say yes to it");
  assert.deepEqual(chooseService("Emergency exam (same-day)", evidence(["gum surgery please"])), { kind: "choose", options: ["Emergency exam (same-day)"] }, "never swapped in silently");
  assert.deepEqual(chooseService("whitening", evidence(["hi"])), { kind: "choose", options: ["In-office teeth whitening (single session)", "Take-home whitening kit (custom trays and gel)"] });
});

test("not on the list, or listed but not requestable: not found, with what can be requested", () => {
  const requestable = { listed: false, options: NAMES };
  assert.deepEqual(chooseService("gum surgery", evidence(["gum surgery please"])), { kind: "not_found", ...requestable });
  assert.deepEqual(chooseService("Whitening touch-up gel (refill)", evidence(["the gel refill"])), { kind: "not_found", listed: true, options: NAMES });
  assert.deepEqual(chooseService("braces", { services: [{ name: "Retainers", requestable: false }], customerSaid: [], offered: [] }), { kind: "not_found", listed: false, options: [] });
});

test("no services table: the service stays as sent", () => {
  assert.deepEqual(chooseService("teeth whitening", { services: [], customerSaid: ["whitening"], offered: [] }), { kind: "ok", service: "teeth whitening" });
});
