import "server-only";
import { db } from "@/lib/db/supabase";
import { ChatHttpError } from "@/lib/chat/turn";

// Rate limits (US-12.6), counted in Postgres (take_rate_limit). Each request
// is checked against a per-session limit (the browser's anonymous id) and a
// per-IP one: a script can make up new session ids, not new addresses.

export interface Limit {
  key: string;
  windowSeconds: number;
  max: number;
}

export const LIMITS = {
  chatSession: (sessionId: string): Limit => ({ key: `chat:session:${sessionId}`, windowSeconds: 60, max: 20 }),
  chatIp: (ip: string): Limit => ({ key: `chat:ip:${ip}`, windowSeconds: 60, max: 60 }),
  // Voice costs per minute: a few call starts per 10 minutes.
  voiceSession: (sessionId: string): Limit => ({ key: `voice:session:${sessionId}`, windowSeconds: 600, max: 3 }),
  voiceIp: (ip: string): Limit => ({ key: `voice:ip:${ip}`, windowSeconds: 600, max: 6 }),
  // Each upload is embedded and each test search embeds the question.
  uploadIp: (ip: string): Limit => ({ key: `upload:ip:${ip}`, windowSeconds: 600, max: 30 }),
  searchIp: (ip: string): Limit => ({ key: `search:ip:${ip}`, windowSeconds: 60, max: 30 }),
};

export const TOO_MANY = "You're sending messages quickly. Please wait a moment and try again.";

// The client's address: the first X-Forwarded-For entry when behind a proxy
// (only trustworthy if the proxy sets it), else X-Real-IP, else "local".
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "local";
}

// Throws a 429 if any limit is exceeded. If the counter itself fails, the
// request goes through (logged): the limiter must not take the chat down.
export async function enforce(limits: Limit[], message = TOO_MANY): Promise<void> {
  const results = await Promise.all(
    limits.map(async (l) => {
      const { data, error } = await db().rpc("take_rate_limit", { p_key: l.key, p_window_seconds: l.windowSeconds, p_max: l.max });
      if (error) {
        console.error(JSON.stringify({ event: "rate_limit_error", key: l.key.split(":").slice(0, 2).join(":"), error: error.message }));
        return true;
      }
      return data === true;
    }),
  );
  if (results.includes(false)) throw new ChatHttpError(429, message);
}
