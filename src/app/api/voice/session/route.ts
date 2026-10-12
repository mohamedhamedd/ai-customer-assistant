import { startCallRequest } from "@/lib/voice/requests";
import { handleVoice } from "@/lib/voice/respond";
import { startVoiceCall } from "@/lib/voice/voice";

// POST /api/voice/session { businessSlug, sessionId, sdp } -> { sdp, callToken }
// Opens a Realtime call for the browser's WebRTC offer and returns the answer,
// plus the secret the call's other requests must carry.
export function POST(request: Request) {
  return handleVoice(request, startCallRequest, "start call", async (input) => Response.json(await startVoiceCall(input)));
}
