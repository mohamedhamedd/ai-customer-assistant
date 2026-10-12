// The number check (PR-16): every price, percentage, time and phone number
// in an answer must come from something the assistant was allowed to know:
// this turn's tool results, the customer's own words, earlier answers, and
// the clock and calendar in its instructions. Plain code, no model: a wrong
// price is the costliest mistake, and this catches it for any business.
//
// Bare numbers ("2 cleanings a year", "Step 1") are not checked: they are
// too often counts or list markers, and checking them would block good
// answers. Money, percentages, times and phone numbers are the facts a
// customer acts on.

export type FigureKind = "money" | "percent" | "time" | "phone";

export interface Figure {
  kind: FigureKind;
  // As written in the answer, for the flag's reason.
  text: string;
}

const MONEY = /(?:[$€£]\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?(?:dollars|usd|euros?|eur|pounds|gbp)\b)/gi;
const PERCENT = /\b\d+(?:\.\d+)?\s?%/g;
// "3 PM", "3:00 p.m.", "11am".
const TIME_12H = /\b(\d{1,2})(?::([0-5]\d))?\s?([ap])\.?\s?m\b/gi;
// "15:00", also inside an ISO timestamp ("2026-10-20T15:00").
const TIME_24H = /(?<![\d:])([01]?\d|2[0-3]):([0-5]\d)(?![\d:]?\s?[ap]\.?\s?m\b)(?!\d)/gi;
// "(503) 555-0142", "503-555-0142", "503.555.0142", "+1 503 555 0142".
const PHONE = /(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g;
// Every number in a text, for matching money and percentages loosely: the
// evidence may say "3,500 to 5,500" where the answer says "$5,500".
const NUMBER = /\d[\d,]*(?:\.\d+)?/g;

const numberKey = (raw: string) => {
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? String(n) : raw;
};

const minutesOf12h = (h: string, m: string | undefined, half: string) => {
  const hour = (Number(h) % 12) + (half.toLowerCase() === "p" ? 12 : 0);
  return hour * 60 + Number(m ?? 0);
};

const phoneKey = (raw: string) => raw.replace(/\D/g, "").slice(-10);

function timesIn(text: string): Set<number> {
  const out = new Set<number>();
  for (const m of text.matchAll(TIME_12H)) {
    if (Number(m[1]) >= 1 && Number(m[1]) <= 12) out.add(minutesOf12h(m[1], m[2], m[3]));
  }
  for (const m of text.matchAll(TIME_24H)) out.add(Number(m[1]) * 60 + Number(m[2]));
  return out;
}

// What the evidence contains, in comparable form.
export interface EvidenceIndex {
  numbers: Set<string>;
  times: Set<number>;
  phones: Set<string>;
}

// Dates and times are matched as times, not as numbers: "20" inside
// "2026-10-20" must not vouch for "20% off".
const DATES_AND_TIMES = /\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?|\b\d{1,2}:\d{2}(?::\d{2})?/g;

export function indexEvidence(evidence: string): EvidenceIndex {
  return {
    numbers: new Set([...evidence.replace(DATES_AND_TIMES, " ").matchAll(NUMBER)].map((m) => numberKey(m[0]))),
    times: timesIn(evidence),
    // Customers type phones without separators too: index every digit run.
    phones: new Set([...[...evidence.matchAll(PHONE)].map((m) => phoneKey(m[0])), ...[...evidence.matchAll(/\d{7,}/g)].map((m) => m[0].slice(-10))]),
  };
}

// The figures in an answer that the evidence doesn't contain.
export function unsupportedFigures(answer: string, evidence: EvidenceIndex): Figure[] {
  const bad: Figure[] = [];
  for (const m of answer.matchAll(MONEY)) {
    const digits = m[0].match(/\d[\d,]*(?:\.\d+)?/)![0];
    if (!evidence.numbers.has(numberKey(digits))) bad.push({ kind: "money", text: m[0].trim() });
  }
  for (const m of answer.matchAll(PERCENT)) {
    if (!evidence.numbers.has(numberKey(m[0].replace(/\s?%/, "")))) bad.push({ kind: "percent", text: m[0] });
  }
  for (const m of answer.matchAll(TIME_12H)) {
    if (Number(m[1]) < 1 || Number(m[1]) > 12) continue;
    if (!evidence.times.has(minutesOf12h(m[1], m[2], m[3]))) bad.push({ kind: "time", text: m[0].trim() });
  }
  for (const m of answer.matchAll(TIME_24H)) {
    if (!evidence.times.has(Number(m[1]) * 60 + Number(m[2]))) bad.push({ kind: "time", text: m[0] });
  }
  for (const m of answer.matchAll(PHONE)) {
    if (!evidence.phones.has(phoneKey(m[0]))) bad.push({ kind: "phone", text: m[0].trim() });
  }
  return bad;
}
