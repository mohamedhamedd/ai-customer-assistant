// Source chips for answers from the business's tables (Admin > Services,
// Admin > Opening hours). A searched answer cites the sections search
// returned; an answer from the tables cites the rows it quotes. Decided by
// code from the answer itself, after it is written: no model call, nothing
// for the model to remember.
//
// - Services: a row is quoted when the answer has its exact name, or one of
//   its figures (a price or duration with a digit, as written) next to one
//   of its main words ("the take-home kit is $199").
// - Opening hours: quoted when the answer has a time the business opens or
//   closes ("2:00 PM", "2 PM", "2pm") and talks about hours (a weekday, or
//   open, close, hours).
//
// Pure, so it is unit-tested. Text chat only: voice speaks figures as words
// ("three hundred and forty-nine dollars"), which don't match the table.
import { describeHours, formatMinutes, formatTime, type Week } from "@/lib/admin/hours-rows";
import type { ServiceRow } from "@/lib/admin/service-rows";
import type { Source } from "@/lib/rag/retrieve";
import type { BusinessTables } from "./prompt";
import { words } from "./service-choice";

// Enough to read in a popover; the full list is in the admin.
const MAX_ROWS = 25;

const flat = (s: string) => s.toLowerCase().replace(/\s+/g, " ");
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The figure as written, not inside a longer one ("$45" is not "$4,500").
function hasFigure(answer: string, figure: string): boolean {
  if (!/\d/.test(figure)) return false;
  return new RegExp(`(^|[^\\w$,.])${escape(flat(figure))}(?![\\d,]\\d|\\w)`).test(answer);
}

function quoted(answer: string, s: ServiceRow): boolean {
  if (answer.includes(flat(s.name))) return true;
  const main = words(s.name.replace(/\([^)]*\)/g, " "));
  const mentioned = main.some((w) => new RegExp(`\\b${escape(w)}`).test(answer));
  return mentioned && (hasFigure(answer, s.price) || hasFigure(answer, s.duration));
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ") || "–";

function servicesSource(rows: ServiceRow[]): Source {
  const shown = rows.slice(0, MAX_ROWS);
  const more = rows.length > shown.length ? `\n\nand ${rows.length - shown.length} more.` : "";
  const table = ["| Service | Price | Duration |", "|---|---|---|", ...shown.map((s) => `| ${cell(s.name)} | ${cell(s.price)} | ${cell(s.duration)} |`)].join("\n");
  return { documentId: "table:services", title: "Services", heading: "", excerpt: table + more, similarity: 1, table: "services" };
}

// "2:00 PM" as the model may write it: "2:00 PM", "2 PM", "2pm", "2:00pm".
function timePattern(hhmm: string, closing: boolean): RegExp | null {
  const text = formatTime(hhmm, closing);
  if (text === "midnight") return /\bmidnight\b/;
  const [, h, m, ampm] = /^(\d+):(\d+) (AM|PM)$/.exec(text)!;
  const minutes = m === "00" ? `(:00)?` : `:${m}`;
  return new RegExp(`\\b${h}${minutes}\\s?${ampm.toLowerCase().split("").join("\\.?")}\\.?(?![a-z])`);
}

const HOURS_TALK = /\b(open|opens|opening|close|closes|closed|closing|hours|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekdays?|weekends?)\b/;

function hoursQuoted(answer: string, week: Week): boolean {
  if (!HOURS_TALK.test(answer)) return false;
  return week.hours.some((r) => [timePattern(r.opens, false), timePattern(r.closes, true)].some((p) => p?.test(answer)));
}

function hoursSource(week: Week): Source {
  const last = week.lastStartBeforeClose ? `\n\nThe last appointment starts ${formatMinutes(week.lastStartBeforeClose)} before closing.` : "";
  return {
    documentId: "table:hours",
    title: "Opening hours",
    heading: "",
    excerpt: describeHours(week.hours).map((d) => `- ${d}`).join("\n") + last,
    similarity: 1,
    table: "hours",
  };
}

// The chips for an answer: services first, then hours. None when the answer
// quotes neither (or the business has no tables).
export function tableSources(answerText: string, { services, week }: BusinessTables): Source[] {
  const answer = flat(answerText);
  const sources: Source[] = [];
  const rows = services.filter((s) => quoted(answer, s));
  if (rows.length) sources.push(servicesSource(rows));
  if (week.hours.length && hoursQuoted(answer, week)) sources.push(hoursSource(week));
  return sources;
}
