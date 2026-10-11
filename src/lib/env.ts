import "server-only";
import { z } from "zod";

// Single source of truth for configuration. Secrets are never NEXT_PUBLIC_,
// so Next.js cannot inline them into the browser bundle; `server-only` makes
// importing this module from a Client Component a build error.
const schema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // Models are config, not code: swap for cost/latency without a deploy.
  OPENAI_CHAT_MODEL: z.string().min(1).default("gpt-4.1-mini"),
  OPENAI_EMBEDDING_MODEL: z.string().min(1).default("text-embedding-3-small"),
  OPENAI_REALTIME_MODEL: z.string().min(1).default("gpt-realtime"),
  OPENAI_REALTIME_VOICE: z.string().min(1).default("alloy"),

  // The customer chat serves one business; the schema supports many.
  DEMO_BUSINESS_SLUG: z.string().min(1).default("lakeside-dental"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

// Parsed lazily so `next build` works without secrets; instrumentation.ts
// calls this at server start so a misconfigured server fails at boot.
export function env(): Env {
  if (cached) return cached;
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}\nSee .env.example.`);
  }
  cached = result.data;
  return cached;
}
