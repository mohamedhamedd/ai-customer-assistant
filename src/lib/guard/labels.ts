// What each guard flag means, in staff words (admin transcript and overview).
// No server imports, so client components can use it.
const LABELS: Record<string, string> = {
  injection: "Prompt injection",
  authority_claim: "Claim of authority",
  internals: "Question about the assistant itself",
  off_topic: "Off-topic request",
  missed: "Attack caught in the answer",
  off_business: "Answer not about the business",
  prompt_leak: "System prompt leak",
};

export function guardLabel(flag: { layer: string; category: string }): string {
  return LABELS[flag.category] ?? (flag.layer === "numbers" ? "Figure not in the documents" : flag.category);
}
