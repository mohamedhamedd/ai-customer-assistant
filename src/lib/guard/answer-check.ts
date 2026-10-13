// The answer check: plain code, no model, on every text answer before it is
// saved. Strictness lives in the system prompt and the tools; this catches
// the two mistakes worth undoing even after the customer saw them stream:
//   1. a leak: the system prompt's secret marker (canary.ts) is in the answer;
//   2. an invented figure: a price, percentage or phone number that appears
//      nowhere the assistant could know it from (figures.ts).
// A failed answer is replaced by a safe reply. Pure, so it is unit-tested.
import { indexEvidence, unsupportedFigures } from "./figures";

export type AnswerCheck = { ok: true } | { ok: false; reason: string; safeReply: string };

export interface AnswerCheckInput {
  answer: string;
  businessName: string;
  canary: string;
  // Everything the assistant was allowed to know this turn: the facts in its
  // prompt, the conversation, and what its tools returned.
  evidence: string;
}

export const leakReply = (businessName: string) => `I can only help with questions about ${businessName}. What would you like to know?`;
export const unsureReply = (businessName: string) => `I don't have that exact information. Would you like someone from ${businessName} to contact you?`;

export function checkAnswer({ answer, businessName, canary, evidence }: AnswerCheckInput): AnswerCheck {
  if (answer.includes(canary)) {
    return { ok: false, reason: "The answer contained the system prompt's secret marker.", safeReply: leakReply(businessName) };
  }
  const figures = unsupportedFigures(answer, indexEvidence(evidence));
  if (figures.length > 0) {
    return {
      ok: false,
      reason: `Not in the documents or the conversation: ${figures.map((f) => f.text).join(", ")}`,
      safeReply: unsureReply(businessName),
    };
  }
  return { ok: true };
}
