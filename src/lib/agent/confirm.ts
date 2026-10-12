// Confirm before write, enforced in code (the prompt asked for it, but a
// prompt rule is a request, not a guarantee: the model was seen saving "my
// friend John Doe, 555-1234" in the same reply the details were given).
//
// The write tools work in two steps, propose then commit:
//   1. A call with new details saves nothing. It returns confirm_first with
//      the details exactly as they would be saved, for the model to read
//      back. The call is recorded in tool_calls like any other: that record
//      is the proposal.
//   2. A call with the same details commits, but only if the customer has
//      said something since that proposal. So the customer always gets a
//      turn to see the details and answer before anything is written.
//
// "The same details" means the same key (ConfirmSpec.key): the details that
// identify what's saved (the contact, or the time slot), compared as data,
// never by reading the model's wording. Free text (interest, service
// wording, notes) may differ between the two calls.
//
// Trade-off: the code guarantees the read-back step and the customer's turn;
// whether the customer's answer was a yes is the model's call (it only
// calls again after one). A correction is a new key, so a new proposal.
import type { ToolOutput } from "./tools";

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
  // The key of this tool's latest proposal in this conversation, and when it
  // was made. Null when there is none (or its arguments no longer parse).
  proposal: { key: string; at: Date } | null;
  // When the customer last sent a message (text, or a voice item, even
  // before its transcript is in).
  customerSpokeAt: Date | null;
}

export function isConfirmed(key: string, state: ProposalState): boolean {
  const { proposal, customerSpokeAt } = state;
  return proposal !== null && proposal.key === key && customerSpokeAt !== null && customerSpokeAt.getTime() > proposal.at.getTime();
}
