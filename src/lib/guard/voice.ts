import "server-only";
import { db } from "@/lib/db/supabase";
import { canary, liveGuards, type Guards } from "./guards";

// Voice (PR-16): speech goes from OpenAI straight to the customer, so an
// answer can't be stopped before it's heard. The same guards run after the
// fact instead: a customer message the input guard would have blocked, and
// an answer that leaks the prompt or leaves the business, are recorded as
// flags. Staff see them in the transcript; the input guard learns from the
// blocked messages for text and voice alike.
//
// Not the number check: spoken figures are words ("three hundred and
// forty-nine dollars"), and voice gets its facts from the same tools.

export interface StoredVoiceItem {
  businessId: string;
  conversationId: string;
  messageId: number;
  role: "user" | "assistant";
  text: string;
}

export async function flagVoiceItem(item: StoredVoiceItem, guards: Guards = liveGuards): Promise<void> {
  try {
    const { data: business, error } = await db().from("businesses").select("id, name, description, assistant_guidelines").eq("id", item.businessId).single();
    if (error) throw new Error(error.message);
    const profile = { id: business.id, name: business.name, description: business.description, guidelines: business.assistant_guidelines };
    const base = { business_id: item.businessId, conversation_id: item.conversationId, message_id: item.messageId, original: item.text };

    if (item.role === "user") {
      const screen = await guards.screen(profile, item.text);
      if (!screen.allowed) await guards.record({ ...base, layer: "input", category: screen.category, reason: `${screen.reason} (voice: heard, not blocked)`, embedding: screen.embedding });
      return;
    }

    if (item.text.includes(canary())) {
      await guards.record({ ...base, layer: "canary", category: "prompt_leak", reason: "The spoken answer contained the system prompt's secret marker." });
      return;
    }
    // The customer's message this answer replies to: the latest one before it.
    const { data: question } = await db()
      .from("messages")
      .select("content")
      .eq("conversation_id", item.conversationId)
      .eq("role", "user")
      .lt("id", item.messageId)
      .not("content", "is", null)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    const scope = await guards.scope(profile, question?.content ?? "", item.text, []);
    if (!scope.inScope) await guards.record({ ...base, layer: "scope", category: "off_business", reason: `${scope.reason} (voice: heard, not blocked)` });
  } catch (err) {
    // After the response: nothing to tell the customer, only the log.
    console.error("[guard] voice check failed", err instanceof Error ? err.message : err);
  }
}
