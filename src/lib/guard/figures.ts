// The number check (PR-16): every price, percentage and phone number in an
// answer must come from something the assistant was allowed to know: this
// turn's tool results, the customer's own words, earlier answers, and the
// facts in its instructions. Plain code, no model: a wrong price is the
// costliest mistake, and this catches it for any business.
//
// Not checked:
// - bare numbers ("2 cleanings a year", "Step 1"): too often counts or list
//   markers;
// - times: a time is as often a suggestion as a fact. The assistant is told
//   to propose an open slot when the customer asks for a closed one ("would
//   11 AM work?"), and that time is in no document. Checking times blocked
//   the consultation flow; hours stay grounded by the search rules.

export type FigureKind = "money" | "percent" | "phone";

export interface Figure {
  kind: FigureKind;
  // As written in the answer, for the flag's reason.
  text: string;
}

const MONEY = /(?:[$€£]\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?(?:dollars|usd|euros?|eur|pounds|gbp)\b)/gi;
const PERCENT = /\b\d+(?:\.\d+)?\s?%/g;
// "(503) 555-0142", "503-555-0142", "503.555.0142", "+1 503 555 0142".
const PHONE = /(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g;
// Every number in a text, for matching money and percentages loosely: the
// evidence may say "3,500 to 5,500" where the answer says "$5,500".
const NUMBER = /\d[\d,]*(?:\.\d+)?/g;

const numberKey = (raw: string) => {
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? String(n) : raw;
};

const phoneKey = (raw: string) => raw.replace(/\D/g, "").slice(-10);

// What the evidence contains, in comparable form.
export interface EvidenceIndex {
  numbers: Set<string>;
  phones: Set<string>;
}

// Dates and times don't count as numbers: "20" inside "2026-10-20" must not
// vouch for "20% off".
const DATES_AND_TIMES = /\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?|\b\d{1,2}:\d{2}(?::\d{2})?/g;

export function indexEvidence(evidence: string): EvidenceIndex {
  return {
    numbers: new Set([...evidence.replace(DATES_AND_TIMES, " ").matchAll(NUMBER)].map((m) => numberKey(m[0]))),
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
  for (const m of answer.matchAll(PHONE)) {
    if (!evidence.phones.has(phoneKey(m[0]))) bad.push({ kind: "phone", text: m[0].trim() });
  }
  return bad;
}
