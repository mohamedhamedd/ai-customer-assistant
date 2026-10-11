import "server-only";
import OpenAI from "openai";
import { env } from "@/lib/env";

let client: OpenAI | undefined;

// Bounded timeout and retries so a slow provider surfaces as a handled
// error instead of a hung request.
export function openai(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: env().OPENAI_API_KEY, timeout: 30_000, maxRetries: 2 });
  }
  return client;
}
