import { startCallRequest } from "@/lib/voice/requests";
import { handleVoice } from "@/lib/voice/respond";
import { startVoiceCall } from "@/lib/voice/voice";

// POST /api/voice/session { businessSlug, sessionId, sdp } -> { sdp }
// Opens a Realtime call for the browser's WebRTC offer and returns the answer.
export function POST(request: Request) {
  return handleVoice(request, startCallRequest, "start call", async (input) => Response.json({ sdp: await startVoiceCall(input) }));
}
