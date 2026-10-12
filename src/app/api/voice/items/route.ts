import { after } from "next/server";
import { flagVoiceItem } from "@/lib/guard/voice";
import { itemRequest } from "@/lib/voice/requests";
import { handleVoice } from "@/lib/voice/respond";
import { recordVoiceItem } from "@/lib/voice/voice";

// POST /api/voice/items { callToken, itemId, role, transcript?, toolCallIds? } -> 204
// Stores a voice message: once when it starts (order), again with its transcript.
// New text is checked by the guards after the response (PR-16): voice can't
// be blocked once spoken, so it's flagged instead.
export function POST(request: Request) {
  return handleVoice(request, itemRequest, "item", async (input) => {
    const stored = await recordVoiceItem(input);
    if (stored) after(() => flagVoiceItem(stored));
    return new Response(null, { status: 204 });
  });
}
