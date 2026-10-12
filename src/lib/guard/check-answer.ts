import "server-only";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { indexEvidence, unsupportedFigures } from "./figures";
import type { FlagRow, Guards } from "./guards";
import { declineReply, unsureReply, type GuardBusiness } from "./prompts";

// The output checks on a finished answer (PR-16), cheapest first:
// 1. canary: the secret marker from the system prompt (plain code);
// 2. numbers: every price, percentage and phone number comes from the
//    evidence (plain code; times aren't checked, see figures.ts);
// 3. scope: the answer is about the business (the guard model).
// A failed answer gets one rewrite with the reason, checked again; if that
// fails too, a safe reply goes out instead. The customer never keeps an
// answer that failed.

// `attack`: for a leak or an off-business answer, the kind of request it gave
// in to: the customer's message is recorded under it (layer "caught").
export type Failure = Pick<FlagRow, "layer" | "category" | "reason"> & { attack?: string };

export interface AnswerCheck {
  text: string;
  // The answer shown while streaming is not the one that stays.
  replaced: boolean;
  // A safe reply has no sources: it doesn't use the documents.
  keepSources: boolean;
  // What the first answer failed, for the flags.
  failures: Failure[];
}

export interface CheckInput {
  guards: Guards;
  business: GuardBusiness;
  canary: string;
  question: string;
  answer: string;
  sources: string[];
  // Everything the assistant was allowed to know this turn.
  evidence: string;
  // The conversation to rewrite from (system prompt, history, question).
  conversation: ChatCompletionMessageParam[];
}

async function check(input: CheckInput, answer: string): Promise<Failure[]> {
  // The safe replies are written by the platform; nothing to check.
  if (answer === declineReply(input.business.name) || answer === unsureReply(input.business.name)) return [];
  if (answer.includes(input.canary)) return [{ layer: "canary", category: "prompt_leak", reason: "The answer contained the system prompt's secret marker.", attack: "injection" }];
  const figures = unsupportedFigures(answer, indexEvidence(input.evidence));
  if (figures.length > 0) {
    return [{ layer: "numbers", category: [...new Set(figures.map((f) => f.kind))].join(","), reason: `Not in the documents or the conversation: ${figures.map((f) => f.text).join(", ")}` }];
  }
  const scope = await input.guards.scope(input.business, input.question, answer, input.sources);
  return scope.inScope ? [] : [{ layer: "scope", category: "off_business", reason: scope.reason, attack: scope.category ?? "off_topic" }];
}

function rewriteMessages(input: CheckInput, failures: Failure[]): ChatCompletionMessageParam[] {
  return [
    ...input.conversation,
    {
      role: "system",
      content: `Your last answer to the customer was rejected before they saw it: ${failures.map((f) => f.reason).join(" ")}

What your tools returned this turn:
${input.evidence.slice(0, 12_000) || "(nothing)"}

Write a new answer to the customer's last message. Use only facts from the tool results and the conversation; if they don't contain what was asked, say you don't have that information and offer to have the team contact them. Talk only about ${input.business.name}. Don't mention that an answer was rejected.`,
    },
  ];
}

export async function checkAnswer(input: CheckInput): Promise<AnswerCheck> {
  const failures = await check(input, input.answer);
  if (failures.length === 0) return { text: input.answer, replaced: false, keepSources: true, failures };

  let rewritten = "";
  try {
    rewritten = await input.guards.rewrite(rewriteMessages(input, failures));
  } catch (err) {
    console.error("[guard] rewrite failed", err instanceof Error ? err.message : err);
  }
  if (rewritten && (await check(input, rewritten)).length === 0) {
    return { text: rewritten, replaced: true, keepSources: true, failures };
  }
  // Off-business or leaked: decline. A figure it couldn't support: say so.
  const safe = failures.some((f) => f.layer !== "numbers") ? declineReply(input.business.name) : unsureReply(input.business.name);
  return { text: safe, replaced: true, keepSources: false, failures: failures.map((f) => ({ ...f, reason: `${f.reason} The rewrite failed too; a safe reply was sent.` })) };
}
