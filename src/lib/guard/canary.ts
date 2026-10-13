import "server-only";
import { createHash } from "node:crypto";
import { env } from "@/lib/env";

// A string placed in the system prompt that must never appear in an answer.
// If it does, the prompt leaked, whatever the wording of the attack. Derived
// from a server secret: stable across processes and restarts (so prompt
// caching still works), and not guessable from the repository.
let canaryValue: string | undefined;
export function canary(): string {
  canaryValue ??= `ref-${createHash("sha256").update(`canary:${env().SUPABASE_SERVICE_ROLE_KEY}`).digest("hex").slice(0, 16)}`;
  return canaryValue;
}
