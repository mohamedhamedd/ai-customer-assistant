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
//   - English affirmations only. Anything else ("bet", "si") fails safe: the
//     model reads the details back once more.
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

const YES =
  /\b(yes|yeah|yea|yep|yup|ya|y|sure|correct|right|exactly|perfect|ok|okay|k|confirm|confirmed|absolutely|definitely|certainly|affirmative|of course|go ahead|please do|do it|sounds good|looks good|all good|that works|great|alright|all right|uh[- ]?huh|mm[- ]?hmm|mhm)\b|👍/;

// A yes that changes something is not a yes to the read-back.
const NOT_YES = /\b(no|nope|nah|not|don't|dont|isn't|wrong|incorrect|wait|hold on|actually|but|change|instead|cancel|stop)\b/;

export function isAffirmation(text: string): boolean {
  const t = text.toLowerCase().replace(/[’‘]/g, "'");
  return YES.test(t) && !NOT_YES.test(t);
}

// ---------------------------------------------------------------------------
// The read-back contains a detail
// ---------------------------------------------------------------------------

export function mentions(readBack: string, detail: Detail): boolean {
  switch (detail.kind) {
    case "email":
      return compact(readBack).includes(compact(detail.value));
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

// One run of characters, for emails and phones, however they were written
// or spoken: "S-A-R-A at example dot com" and "sara@example.com" are both
// "sara@example.com"; "(503) 555-0142" is "5035550142".
function compact(s: string): string {
  return digitsForWords(s.toLowerCase())
    .replace(/\bat\b/g, "@")
    .replace(/\bdot\b/g, ".")
    .replace(/\bunderscore\b/g, "_")
    .replace(/\bplus\b/g, "+")
    .replace(/\b(dash|hyphen)\b/g, "")
    .replace(/[^a-z0-9@._+]/g, "");
}

// The read-back may add or drop a country code: "+1 503 555 0142" for
// 5035550142, or the reverse. At least 7 digits must match either way.
function mentionsPhone(readBack: string, phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  const runs = compact(readBack).match(/\d+/g) ?? [];
  return runs.some((run) => run.includes(digits) || (run.length >= 7 && digits.endsWith(run)));
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

// "2026-10-20T15:00" is read back as e.g. "Tuesday, October 20 at 3:00 PM",
// "20 Oct, 15:00" or (spoken) "October twentieth at three p.m.".
function mentionsDateTime(readBack: string, local: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) return false;
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  const t = digitsForWords(readBack.toLowerCase())
    .replace(/\b([ap])\.\s?m\b\.?/g, "$1m")
    .replace(/\b(\d{1,2})(st|nd|rd|th)\b/g, "$1");
  return mentionsDate(t, year, month, day) && mentionsTime(t, hour, minute);
}

function mentionsDate(t: string, year: number, month: number, day: number): boolean {
  const name = MONTHS[month - 1];
  const monthWord = `(?:${name}|${name.slice(0, 3)}${name === "september" ? "t?" : ""}\\.?)`;
  const d = `0?${day}`;
  return [
    `\\b${monthWord}\\s+(?:the\\s+)?${d}\\b`,
    `\\b${d}\\s+(?:of\\s+)?${monthWord}(?![a-z])`,
    `\\b${year}-${pad(month)}-${pad(day)}\\b`,
    `\\b0?${month}/${d}\\b`,
  ].some((p) => new RegExp(p).test(t));
}

function mentionsTime(t: string, hour: number, minute: number): boolean {
  const h12 = hour % 12 || 12;
  const ampm = hour < 12 ? "am" : "pm";
  // "3:05" can be spoken "three oh five".
  const mm = minute === 0 ? "(?::00)?" : `(?::|\\s)(?:${pad(minute)}${minute < 10 ? `|0\\s${minute}` : ""})`;
  const patterns = [
    // 12-hour, with am/pm: "3 pm", "3:00 PM", "3 30 pm"
    `\\b${h12}${mm}\\s*${ampm}\\b`,
    // 24-hour: "15:00", "09:30" (not followed by am/pm, which would make it 12-hour)
    `\\b0?${hour}:${pad(minute)}\\b(?!\\s*[ap]m)`,
  ];
  if (hour === 12 && minute === 0) patterns.push("\\b(?:noon|midday)\\b");
  return patterns.some((p) => new RegExp(p).test(t));
}

const pad = (n: number) => String(n).padStart(2, "0");
