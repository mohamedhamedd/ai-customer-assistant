import { startCallRequest } from "@/lib/voice/requests";
import { requireBusiness } from "@/lib/chat/turn";
import { enforce, ipLimit, LIMITS } from "@/lib/rate-limit";
import { handleVoice } from "@/lib/voice/respond";
import { startVoiceCall } from "@/lib/voice/voice";

// POST /api/voice/session { businessSlug, sessionId, sdp } -> { sdp, callToken }
// Opens a Realtime call for the browser's WebRTC offer and returns the answer,
// plus the secret the call's other requests must carry.
export function POST(request: Request) {
  return handleVoice(request, startCallRequest, "start call", async (input) => {
    const tooMany = "You've started several voice calls in a short time. Please wait a few minutes, or keep typing.";
    // Per visitor first; the business's ceiling only for a real business.
    await enforce([[LIMITS.voiceSession(input.sessionId), ...ipLimit(request, LIMITS.voiceIp)]], tooMany);
    const business = await requireBusiness(input.businessSlug);
    await enforce([[LIMITS.voiceBusiness(business.id)]], tooMany);
    return Response.json(await startVoiceCall(input));
  });
}
