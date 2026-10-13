import "server-only";
import { db } from "@/lib/db/supabase";
import { env } from "@/lib/env";
import { ChatHttpError } from "@/lib/chat/turn";

// Rate limits (US-12.6), counted in Postgres (take_rate_limit).
//
// Three kinds of key, each covering what the others can't:
//   - per session: the browser's anonymous id (one visitor's pace),
//   - per IP: only when the deployment names the header its proxy sets
//     (TRUSTED_IP_HEADER), since a client can send any header it likes,
//   - per business: a ceiling on cost nobody can raise by making up sessions
//     or addresses. Checked last, so a request the per-visitor limits turn
//     away doesn't use it up; per-IP limits behind a proxy are what keep one
//     abuser from exhausting it (bot protection would be the next step).

export interface Limit {
  key: string;
  windowSeconds: number;
  max: number;
}

export const LIMITS = {
  chatSession: (sessionId: string): Limit => ({ key: `chat:session:${sessionId}`, windowSeconds: 60, max: 20 }),
  chatIp: (ip: string): Limit => ({ key: `chat:ip:${ip}`, windowSeconds: 60, max: 60 }),
  // Business ceilings are keyed by id, not slug: a rename must not start
  // them again from zero.
  chatBusiness: (businessId: string): Limit => ({ key: `chat:business:${businessId}`, windowSeconds: 60, max: 300 }),
  // Voice costs per minute: a few call starts per 10 minutes.
  voiceSession: (sessionId: string): Limit => ({ key: `voice:session:${sessionId}`, windowSeconds: 600, max: 3 }),
  voiceIp: (ip: string): Limit => ({ key: `voice:ip:${ip}`, windowSeconds: 600, max: 6 }),
  voiceBusiness: (businessId: string): Limit => ({ key: `voice:business:${businessId}`, windowSeconds: 600, max: 30 }),
  // Loading the conversation is cheap but unbounded without a limit; a
  // reload now and then is normal, so this is looser than sending.
  historySession: (sessionId: string): Limit => ({ key: `history:session:${sessionId}`, windowSeconds: 60, max: 60 }),
  historyBusiness: (businessId: string): Limit => ({ key: `history:business:${businessId}`, windowSeconds: 60, max: 1200 }),
  historyIp: (ip: string): Limit => ({ key: `history:ip:${ip}`, windowSeconds: 60, max: 120 }),
  // Each upload is embedded and each test search embeds the question.
  uploadBusiness: (businessId: string): Limit => ({ key: `upload:business:${businessId}`, windowSeconds: 600, max: 30 }),
  searchBusiness: (businessId: string): Limit => ({ key: `search:business:${businessId}`, windowSeconds: 60, max: 30 }),
  // The admin is public in this demo (A1): bound how fast anyone can add
  // businesses or rewrite a profile.
  createBusiness: (): Limit => ({ key: "business:create", windowSeconds: 3600, max: 20 }),
  createBusinessIp: (ip: string): Limit => ({ key: `business:create:ip:${ip}`, windowSeconds: 3600, max: 5 }),
  saveProfile: (businessId: string): Limit => ({ key: `profile:business:${businessId}`, windowSeconds: 600, max: 30 }),
  saveServices: (businessId: string): Limit => ({ key: `services:save:business:${businessId}`, windowSeconds: 600, max: 30 }),
};

export const TOO_MANY = "You're sending messages quickly. Please wait a moment and try again.";

// The client's address, or null when it can't be known. Only from the
// header the deployment's own proxy sets; for X-Forwarded-For, the LAST
// entry (the one that proxy appended; earlier ones are the client's claim).
export function clientIp(request: Request, header = env().TRUSTED_IP_HEADER): string | null {
  if (!header) return null;
  const values = request.headers.get(header)?.split(",").map((s) => s.trim()).filter(Boolean);
  if (!values?.length) return null;
  return header === "x-forwarded-for" ? values.at(-1)! : values[0];
}

// The per-IP limit when the address is known; nothing otherwise (sharing
// one "unknown" bucket would cap all visitors together).
export function ipLimit(request: Request, limit: (ip: string) => Limit): Limit[] {
  const ip = clientIp(request);
  return ip ? [limit(ip)] : [];
}

// Throws a 429 if any limit is exceeded. Tiers are checked in order and
// stop at the first one over its limit, so later tiers (the business
// ceiling) aren't spent on requests an earlier tier turned away. If the
// counter itself fails, the request goes through (logged): the limiter must
// not take the chat down.
export async function enforce(tiers: Limit[][], message = TOO_MANY): Promise<void> {
  for (const tier of tiers) {
    const results = await Promise.all(tier.map(take));
    const tripped = tier.filter((_, i) => !results[i]);
    if (tripped.length) {
      // The kind of limit only (e.g. "chat:business"), never the session id or address.
      console.warn(JSON.stringify({ event: "rate_limited", limits: tripped.map(kindOf) }));
      throw new ChatHttpError(429, message);
    }
  }
}

const kindOf = (l: Limit) => l.key.split(":").slice(0, 2).join(":");

async function take(l: Limit): Promise<boolean> {
  const { data, error } = await db().rpc("take_rate_limit", { p_key: l.key, p_window_seconds: l.windowSeconds, p_max: l.max });
  if (error) {
    console.error(JSON.stringify({ event: "rate_limit_error", key: kindOf(l), error: error.message }));
    return true;
  }
  return data === true;
}
