import { itemRequest } from "@/lib/voice/requests";
import { handleVoice } from "@/lib/voice/respond";
import { recordVoiceItem } from "@/lib/voice/voice";

// POST /api/voice/items { callToken, itemId, role, transcript?, toolCallIds? } -> 204
// Stores a voice message: once when it starts (order), again with its transcript.
export function POST(request: Request) {
  return handleVoice(request, itemRequest, "item", async (input) => {
    await recordVoiceItem(input);
    return new Response(null, { status: 204 });
  });
}
