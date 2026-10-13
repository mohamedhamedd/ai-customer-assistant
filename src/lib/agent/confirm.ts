// Confirm before write, enforced in code (the prompt asked for it, but a
// prompt rule is a request, not a guarantee: the model was seen saving "my
// friend John Doe, 555-1234" in the same reply the details were given).
//
// The write tools work in two steps, propose then commit:
//   1. A call with new details saves nothing. It returns confirm_first with
//      the details exactly as they would be saved, for the model to read
//      back. The call is recorded in tool_calls like any other: that record
//      is the proposal.
//   2. A call with the same details commits, but only once the read-back
//      reached the customer (the next assistant message, stored with words,
//      not replaced by an answer check) and the customer answered it, within
//      ANSWER_WINDOW_MS. A turn that failed after proposing, or a read-back
//      the answer check replaced, delivered nothing, so nothing can commit.
//
// "The same details" means the same key (ConfirmSpec.propose): the details
// that identify what's saved (the contact, or the time slot and service),
// compared as data, never by reading the model's wording. Free text
// (interest, notes) may differ between the two calls. A correction is a new
// key, so a new proposal. A repeat of a committed write commits again (the
// saves are idempotent): the answer it relies on is still the first one.
//
// Trade-off: the code guarantees the read-back and the customer's answer;
// whether that answer was a yes is the model's call (it only calls again
// after one).
import type { ToolOutput } from "./tools";

// An answer much later than the read-back is not an answer to it: a customer
// who comes back next week saying "hi" hasn't confirmed anything.
export const ANSWER_WINDOW_MS = 30 * 60_000;

// The details the customer gave, without the fields they didn't.
export function confirmFirst(details: Record<string, unknown>): ToolOutput {
  details = Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined));
  return {
    ok: false,
    error: "confirm_first",
    message:
      "Nothing is saved yet. Read the details back to the customer and ask them to confirm before saving. When they say yes, call this tool again with the same details.",
    details,
  };
}

export interface ProposalState {
  // This tool's latest proposal in the conversation. Null when there is none
  // (or its arguments no longer parse).
  proposal: { key: string; at: Date } | null;
  // The first assistant message after the proposal: the read-back. Delivered
  // when the customer saw or heard it.
  readBack: { at: Date; delivered: boolean } | null;
  // The customer's first message after the read-back: their answer.
  answerAt: Date | null;
}

export function isConfirmed(key: string, { proposal, readBack, answerAt }: ProposalState): boolean {
  if (!proposal || proposal.key !== key || !readBack?.delivered || !answerAt) return false;
  const [proposed, readOut, answered] = [proposal.at, readBack.at, answerAt].map((d) => d.getTime());
  return proposed < readOut && readOut < answered && answered - readOut <= ANSWER_WINDOW_MS;
}
