// What each guard flag means, in staff words (admin transcript and overview).
// No server imports, so client components can use it.
const LABELS: Record<string, string> = {
  injection: "Prompt injection",
  authority_claim: "Claim of authority",
  internals: "Question about the assistant itself",
  off_topic: "Off-topic request",
  off_business: "Answer not about the business",
  prompt_leak: "System prompt leak",
};

export function guardLabel(flag: { layer: string; category: string }): string {
  const label = LABELS[flag.category] ?? (flag.layer === "numbers" ? "Figure not in the documents" : flag.category);
  // A customer message whose answer an output check replaced.
  return flag.layer === "caught" ? `${label} (caught in the answer)` : label;
}

// Blocks of customer messages are what staff review (and what the guard
// learns from once confirmed).
export const isReviewable = (flag: { layer: string }) => flag.layer === "input" || flag.layer === "caught";
