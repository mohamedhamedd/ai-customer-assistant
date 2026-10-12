import "server-only";
import { createHash } from "node:crypto";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { db } from "@/lib/db/supabase";
import { env } from "@/lib/env";
import { openai } from "@/lib/openai";
import { embedTexts } from "@/lib/rag/embed";
import { inputGuardMessages, inputGuardSchema, scopeCheckMessages, scopeCheckSchema, type GuardBusiness, type InputCategory } from "./prompts";

// The guards around the agent (PR-16). Behind one interface, so the chat
// turn can be tested with fakes and the eval can switch them off for a
// baseline.
//
// The model-based checks fail open: if the guard model is down or slow, the
// customer still gets an answer (the plain-code checks still run). Blocking
// every customer because a classifier timed out would be the worse outage.

export type Screen = { allowed: true; embedding?: number[] } | { allowed: false; category: Exclude<InputCategory, "ok">; reason: string; embedding?: number[] };

export interface FlagRow {
  business_id: string;
  conversation_id: string;
  message_id: number | null;
  layer: "input" | "canary" | "scope" | "numbers";
  category: string;
  reason: string;
  original: string;
  embedding?: number[];
}

export interface Guards {
  // The input guard: is this customer message safe to answer?
  screen(business: GuardBusiness & { id: string }, message: string): Promise<Screen>;
  // The scope check: is this answer about the business?
  scope(business: GuardBusiness, question: string, answer: string, sources: string[]): Promise<{ inScope: boolean; reason: string }>;
  // One more try at an answer that failed a check, with the reason.
  rewrite(messages: ChatCompletionMessageParam[]): Promise<string>;
  record(flag: FlagRow): Promise<void>;
}

// How long the input guard may take before the turn goes on without it.
export const SCREEN_TIMEOUT_MS = 3_000;
const SCOPE_TIMEOUT_MS = 5_000;

const log = (message: string, err?: unknown) => console.error(`[guard] ${message}`, err instanceof Error ? err.message : (err ?? ""));

async function classify<T>(messages: ChatCompletionMessageParam[], schema: typeof inputGuardSchema | typeof scopeCheckSchema, timeoutMs: number): Promise<T> {
  const res = await openai().chat.completions.create(
    { model: env().OPENAI_GUARD_MODEL, messages, temperature: 0, max_completion_tokens: 120, response_format: schema },
    { signal: AbortSignal.timeout(timeoutMs) },
  );
  return JSON.parse(res.choices[0]?.message?.content ?? "{}") as T;
}

export const liveGuards: Guards = {
  async screen(business, message) {
    let embedding: number[] | undefined;
    try {
      // The past blocked messages most like this one are the guard's examples.
      [embedding] = await embedTexts([message.slice(0, 2000)]);
      const { data: examples } = await db().rpc("similar_flags", { p_business_id: business.id, p_embedding: JSON.stringify(embedding), p_limit: 3 });
      const verdict = await classify<{ category: InputCategory; reason: string }>(inputGuardMessages(business, message, examples ?? []), inputGuardSchema, SCREEN_TIMEOUT_MS);
      if (verdict.category === "ok" || !verdict.category) return { allowed: true, embedding };
      return { allowed: false, category: verdict.category, reason: verdict.reason ?? "", embedding };
    } catch (err) {
      log("screen failed; allowing", err);
      return { allowed: true, embedding };
    }
  },

  async scope(business, question, answer, sources) {
    try {
      const verdict = await classify<{ in_scope: boolean; reason: string }>(scopeCheckMessages(business, question, answer, sources), scopeCheckSchema, SCOPE_TIMEOUT_MS);
      return { inScope: verdict.in_scope !== false, reason: verdict.reason ?? "" };
    } catch (err) {
      log("scope check failed; allowing", err);
      return { inScope: true, reason: "" };
    }
  },

  async rewrite(messages) {
    const res = await openai().chat.completions.create(
      { model: env().OPENAI_CHAT_MODEL, messages, temperature: 0.2, max_completion_tokens: 800 },
      { signal: AbortSignal.timeout(20_000) },
    );
    return res.choices[0]?.message?.content?.trim() ?? "";
  },

  async record(flag) {
    const { error } = await db()
      .from("flags")
      .insert({ ...flag, embedding: flag.embedding ? JSON.stringify(flag.embedding) : null });
    // Recording must never break the customer's answer.
    if (error) log(`recording a ${flag.layer} flag failed`, error.message);
  },
};

// A string placed in the system prompt that must never appear in an answer.
// If it does, the prompt leaked, whatever the wording of the attack. Derived
// from a server secret: stable across processes and restarts (so prompt
// caching still works), and not guessable from the repository.
let canaryValue: string | undefined;
export function canary(): string {
  canaryValue ??= `ref-${createHash("sha256").update(`canary:${env().SUPABASE_SERVICE_ROLE_KEY}`).digest("hex").slice(0, 16)}`;
  return canaryValue;
}
