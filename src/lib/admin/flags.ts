import "server-only";
import { db } from "@/lib/db/supabase";
import { ChatHttpError } from "@/lib/chat/turn";

// Staff review of what the guards blocked (PR-16): a confirmed attack
// teaches the input guard (it's shown to it as an example); a dismissed one
// was a real customer, misjudged: never an example, back in the
// conversation's history, and a "must not block" case for the eval.
// Only blocks of customer messages are reviewed; replaced answers aren't.

export type Review = "confirmed" | "dismissed";

export async function reviewFlag(businessId: string, flagId: number, status: Review) {
  const { data, error } = await db()
    .from("flags")
    .update({ status, reviewed_at: new Date().toISOString() })
    .eq("business_id", businessId)
    .eq("id", flagId)
    .in("layer", ["input", "caught"])
    .select("id, status")
    .maybeSingle();
  if (error) throw new Error(`Reviewing flag failed: ${error.message}`);
  if (!data) throw new ChatHttpError(404, "That flag doesn't exist.");
  return data;
}
