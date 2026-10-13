// A plain yes to a read-back ("Just to confirm: …. Is that right?"): the
// chat commits what was read back without waiting for the model to call the
// tool again (turn.ts). Plain only: the whole message is an agreement, with
// nothing added ("yes, but make it 4 pm" goes to the model as before).
// Seen live: after "yes", the model said "I have updated your contact
// details" without calling anything.

const YES = new Set([
  "yes", "yeah", "yea", "yep", "yup", "ya", "y", "ok", "okay", "k", "sure", "correct", "right", "exactly", "perfect",
  "confirm", "confirmed", "alright", "all right", "sounds good", "go ahead", "do it", "that's right", "that is right",
  "that's correct", "that is correct", "it's right", "it's correct", "yes it is", "yes please", "yes correct", "yes that's right",
  "yes that's correct", "yes go ahead", "yes thanks", "yes thank you", "correct thanks", "yes yes", "👍", "✅",
]);

export function isPlainYes(message: string): boolean {
  const normalized = message
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[.,!?;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return YES.has(normalized);
}
