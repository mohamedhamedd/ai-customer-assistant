import { startCallRequest } from "@/lib/voice/requests";
import { clientIp, enforce, LIMITS } from "@/lib/rate-limit";
import { handleVoice } from "@/lib/voice/respond";
import { startVoiceCall } from "@/lib/voice/voice";

// POST /api/voice/session { businessSlug, sessionId, sdp } -> { sdp, callToken }
// Opens a Realtime call for the browser's WebRTC offer and returns the answer,
// plus the secret the call's other requests must carry.
export function POST(request: Request) {
  return handleVoice(request, startCallRequest, "start call", async (input) => {
    await enforce([LIMITS.voiceSession(input.sessionId), LIMITS.voiceIp(clientIp(request))], "You've started several voice calls in a short time. Please wait a few minutes, or keep typing.");
    return Response.json(await startVoiceCall(input));
  });
}
