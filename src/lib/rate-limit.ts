import "server-only";
import { db } from "@/lib/db/supabase";
import { env } from "@/lib/env";
import { ChatHttpError } from "@/lib/chat/turn";

// Rate limits (US-12.6), counted in Postgres (take_rate_limit).
//
// Three kinds of key, each covering what the others can't:
//   - per session: the browser's anonymous id (one visitor's pace),
//   - per IP: only behind a trusted proxy (TRUST_PROXY), since a client can
//     write any X-Forwarded-For it likes and the app can't see the address,
//   - per business: a ceiling nobody can get around by making up sessions or
//     addresses, which bounds the cost of the paid calls.

export interface Limit {
  key: string;
  windowSeconds: number;
  max: number;
}

export const LIMITS = {
  chatSession: (sessionId: string): Limit => ({ key: `chat:session:${sessionId}`, windowSeconds: 60, max: 20 }),
  chatIp: (ip: string): Limit => ({ key: `chat:ip:${ip}`, windowSeconds: 60, max: 60 }),
  chatBusiness: (slug: string): Limit => ({ key: `chat:business:${slug}`, windowSeconds: 60, max: 300 }),
  // Voice costs per minute: a few call starts per 10 minutes.
  voiceSession: (sessionId: string): Limit => ({ key: `voice:session:${sessionId}`, windowSeconds: 600, max: 3 }),
  voiceIp: (ip: string): Limit => ({ key: `voice:ip:${ip}`, windowSeconds: 600, max: 6 }),
  voiceBusiness: (slug: string): Limit => ({ key: `voice:business:${slug}`, windowSeconds: 600, max: 30 }),
  // Each upload is embedded and each test search embeds the question.
  uploadBusiness: (slug: string): Limit => ({ key: `upload:business:${slug}`, windowSeconds: 600, max: 30 }),
  searchBusiness: (slug: string): Limit => ({ key: `search:business:${slug}`, windowSeconds: 60, max: 30 }),
};

export const TOO_MANY = "You're sending messages quickly. Please wait a moment and try again.";

// The client's address, or null when it can't be known. Only behind a
// trusted proxy: X-Real-IP, else the LAST X-Forwarded-For entry (the one
// the proxy added; earlier entries are whatever the client sent).
export function clientIp(request: Request, trustProxy = env().TRUST_PROXY): string | null {
  if (!trustProxy) return null;
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean);
  return forwarded?.at(-1) ?? null;
}

// The per-IP limit when the address is known; nothing otherwise (sharing
// one "unknown" bucket would cap all visitors together).
export function ipLimit(request: Request, limit: (ip: string) => Limit): Limit[] {
  const ip = clientIp(request);
  return ip ? [limit(ip)] : [];
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
