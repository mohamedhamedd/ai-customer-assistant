// Confirm before write, enforced in code (the prompt asks for it too, but a
// prompt rule is a request, not a guarantee: the model was seen saving
// "my friend John Doe, 555-1234" in the same reply the details were given).
//
// A write tool runs only when BOTH hold:
//   1. the assistant's previous message read the key details back: every
//      email and phone being saved, the date and time being requested;
//   2. the customer's latest message is a yes.
// Otherwise the tool returns CONFIRM_FIRST and the model asks.
//
// Pure, so it is unit-tested; execute.ts loads the two messages.
//
// Trade-offs (deliberately simple string checks, no second model call):
//   - Only the details that identify the action are matched: email, phone,
//     date and time. Name, interest, service and notes are not (they are
//     paraphrased too often to match reliably).
//   - A yes must open the customer's message, and a question isn't one
//     ("Ok, is there parking?"). English only. Anything else ("Thanks, yes",
//     "si") fails safe: the model reads the details back once more.
//   - Details are matched whole: the exact email and phone number, and the
//     date and time together as one slot ("October 20 at 3 PM"), so part of
//     a read-back ("smith@" in "jsmith@", 3 PM from one option and October 21
//     from another) never vouches for something else.
//   - A read-back that says the details in an unusual way ("half past three",
//     "the email ending in example.com") also fails safe, at the cost of one
//     extra question. The prompt asks for the full details to keep that rare.
//   - Spoken read-backs (voice transcripts) are covered: number words become
//     digits, "at"/"dot" become "@"/".", spelled-out letters are joined.
import type { ToolOutput } from "./tools";

export const CONFIRM_FIRST: ToolOutput = {
  ok: false,
  error: "confirm_first",
  message: "Read the details back to the customer and ask them to confirm before saving.",
};

// What a read-back must contain. Values are the tool's validated arguments:
// email lowercased, phone as "+" and digits, datetime as "YYYY-MM-DDTHH:mm".
export type Detail = { kind: "email"; value: string } | { kind: "phone"; value: string } | { kind: "datetime"; value: string };

export interface LastExchange {
  // The customer's latest message. Null when there is none, or its voice
  // transcript isn't in yet.
  customer: string | null;
  // The assistant's last message before it.
  readBack: string | null;
}

export function isConfirmed(details: Detail[], exchange: LastExchange): boolean {
  if (!exchange.customer || !exchange.readBack || !isAffirmation(exchange.customer)) return false;
  const readBack = exchange.readBack;
  return details.every((d) => mentions(readBack, d));
}

// ---------------------------------------------------------------------------
// The customer said yes
// ---------------------------------------------------------------------------

// The message opens with a yes (after an "oh" or "well"). A word ends at a
// space, a comma, "!" or a final ".", so "y.ali@example.com" is not "y".
const YES = new RegExp(
  "^(?:(?:oh|ah|um|uh|well|hmm)[\\s,]+)?" +
    "(?:yes|yeah|yea|yep|yup|ya|sure|correct|right|exactly|perfect|great|ok|okay|alright|all right|absolutely|definitely|certainly|of course|confirm|confirmed|affirmative|" +
    "go ahead|please do|do it|sounds good|looks good|all good|that works|that'?s (?:right|correct|it|perfect|fine)|that is (?:right|correct)|it'?s (?:right|correct)|" +
    "uh[- ]?huh|mm[- ]?hmm|mhm)" +
    "(?=$|[\\s,!]|\\.(?!\\w))",
);
// A lone letter is a yes only as the whole message.
const LONE_YES = /^(?:y|k|👍)[\s.!]*$/u;

// A yes that changes something is not a yes to the read-back.
const NOT_YES = /\b(no|nope|nah|not|don't|dont|isn't|wrong|incorrect|wait|hold on|actually|but|change|instead|cancel|stop)\b/;

export function isAffirmation(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[’‘]/g, "'");
  if (t.includes("?") || NOT_YES.test(t)) return false;
  return YES.test(t) || LONE_YES.test(t) || t.startsWith("👍");
}

// ---------------------------------------------------------------------------
// The read-back contains a detail
// ---------------------------------------------------------------------------

export function mentions(readBack: string, detail: Detail): boolean {
  switch (detail.kind) {
    case "email":
      return emailsIn(readBack).includes(detail.value.toLowerCase());
    case "phone":
      return mentionsPhone(readBack, detail.value);
    case "datetime":
      return mentionsDateTime(readBack, detail.value);
  }
}

const UNITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const ORDINALS = ["zeroth", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth"];
const TENS: Record<string, number> = { twenty: 20, twentieth: 20, thirty: 30, thirtieth: 30, forty: 40, fortieth: 40, fifty: 50, fiftieth: 50 };
const SMALL: Record<string, number> = { oh: 0, ...Object.fromEntries(UNITS.map((w, i) => [w, i])), ...Object.fromEntries(ORDINALS.map((w, i) => [w, i])) };
const SMALL_WORD = Object.keys(SMALL).join("|");
// After a tens word, only 1 to 9: "twenty-one", not "twenty twelve".
const UNIT_WORD = [...UNITS.slice(1, 10), ...ORDINALS.slice(1, 10)].join("|");
const NUMBER_WORDS = new RegExp(`\\b(?:(${Object.keys(TENS).join("|")})(?:[\\s-]+(${UNIT_WORD}))?|(${SMALL_WORD}))\\b`, "g");

// Spoken numbers to digits: "twenty-first" -> 21, "three thirty" -> "3 30",
// "five five five" -> "5 5 5". Enough for days, times and phone digits.
function digitsForWords(s: string): string {
  return s.replace(NUMBER_WORDS, (_, tens: string | undefined, unit: string | undefined, small: string | undefined) => {
    if (tens) return String(TENS[tens] + (unit ? SMALL[unit] : 0));
    return String(SMALL[small!]);
  });
}

// Every email address in a read-back, however it was written or spoken:
// "sara@example.com", "S-A-R-A at example dot com", "sara dot ali at
// example dot co dot uk". Number words are left alone ("john.one@").
function emailsIn(readBack: string): string[] {
  const spoken = readBack
    .toLowerCase()
    // Spelled out letter by letter: "s-a-r-a", "s, a, r, a", "s a r a".
    .replace(/(?<![\w'])[a-z0-9](?:(?:[\s,]+|-)[a-z0-9]\b)+/g, (letters) => letters.replace(/[\s,-]/g, ""))
    .replace(/[\s,]*\b(?:dash|hyphen)\b[\s,]*/g, "-")
    .replace(/[\s,]*\bunderscore\b[\s,]*/g, "_")
    .replace(/[\s,]*\bdot\b[\s,]*/g, ".")
    .replace(/[\s,]*\bat\b[\s,]*/g, "@");
  return [...spoken.matchAll(/[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/g)].map((m) => m[0]);
}

// Each phone number in a read-back, as digits: "(503) 555-0142",
// "+1 503 555 0142", spoken "five oh three, five five five, ...". Spoken
// digits are often separated by commas, written numbers never are: both
// readings are tried, so "555-0142, 20 October" is still 5550142.
function phonesIn(readBack: string): string[] {
  const text = digitsForWords(readBack.toLowerCase());
  const written = text.match(/\d(?:[\s().-]*\d)*/g) ?? [];
  const spoken = text.match(/\d(?:(?:[\s().-]|,\s?)*\d)*/g) ?? [];
  return [...written, ...spoken].map((run) => run.replace(/\D/g, ""));
}

// The whole number must match. The only allowed difference is a country
// code (1 to 3 digits) on a full number: "+1 503 555 0142" for 5035550142.
function mentionsPhone(readBack: string, phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return phonesIn(readBack).some((run) => {
    if (run === digits) return true;
    const [short, long] = run.length < digits.length ? [run, digits] : [digits, run];
    return short.length >= 10 && long.length - short.length <= 3 && long.endsWith(short);
  });
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const WEEKDAYS = "(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\\.?";

// "2026-10-20T15:00" read back as one slot: "Tuesday, October 20 at 3:00
// PM", "20 Oct, 15:00", "3 PM on Tuesday, October 20", or (spoken)
// "October twentieth at three p.m.". The date and the time must be next to
// each other, so "October 21 at 10 AM or October 20 at 3 PM" vouches for
// those two slots only.
function mentionsDateTime(readBack: string, local: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) return false;
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  const t = digitsForWords(readBack.toLowerCase())
    .replace(/\b([ap])\.\s?m\b\.?/g, "$1m")
    .replace(/\b(\d{1,2})(st|nd|rd|th)\b/g, "$1");
  const date = datePattern(year, month, day);
  const time = timePattern(hour, minute);
  return [
    // date, then time: "October 20, 2026 at 3:00 PM", "20 Oct, 15:00"
    `${date}(?:,?\\s+${year})?\\s*,?\\s*(?:at\\s+|@\\s*|-\\s*|–\\s*)?${time}`,
    // time, then date: "3 PM on Tuesday, October 20"
    `${time}\\s*,?\\s*(?:on\\s+)?(?:${WEEKDAYS},?\\s+)?${date}`,
    // ISO: "2026-10-20T15:00", "2026-10-20 at 15:00"
    `\\b${year}-${pad(month)}-${pad(day)}(?:t|\\s+(?:at\\s+)?)${time}`,
  ].some((p) => new RegExp(p).test(t));
}

function datePattern(year: number, month: number, day: number): string {
  const name = MONTHS[month - 1];
  const monthWord = `(?:${name}|${name.slice(0, 3)}${name === "september" ? "t?" : ""}\\.?)`;
  const d = `0?${day}`;
  return `(?:\\b${monthWord}\\s+(?:the\\s+)?${d}\\b|\\b(?:the\\s+)?${d}\\s+(?:of\\s+)?${monthWord}(?![a-z])|\\b0?${month}/${d}\\b)`;
}

function timePattern(hour: number, minute: number): string {
  const h12 = hour % 12 || 12;
  const ampm = hour < 12 ? "am" : "pm";
  // "3:05" can be spoken "three oh five".
  const mm = minute === 0 ? "(?::00)?" : `(?::|\\s)(?:${pad(minute)}${minute < 10 ? `|0\\s${minute}` : ""})`;
  const forms = [
    // 12-hour, with am/pm: "3 pm", "3:00 PM", "3 30 pm"
    `\\b${h12}${mm}\\s*${ampm}\\b`,
    // 24-hour: "15:00", "09:30" (not followed by am/pm, which would make it 12-hour)
    `\\b0?${hour}:${pad(minute)}\\b(?!\\s*[ap]m)`,
  ];
  if (hour === 12 && minute === 0) forms.push("\\b(?:noon|midday)\\b");
  return `(?:${forms.join("|")})`;
}

const pad = (n: number) => String(n).padStart(2, "0");
