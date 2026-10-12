import { z } from "zod";
import { BUSINESS_SLUG, MAX_SLUG_CHARS } from "@/lib/chat/limits";

// Request shapes for the voice routes.

const target = {
  businessSlug: z.string().max(MAX_SLUG_CHARS).regex(BUSINESS_SLUG, "Unknown business."),
  sessionId: z.uuid("sessionId must be a UUID"),
};

// Realtime ids look like "item_Cb1x…" / "call_…".
const realtimeId = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/, "Invalid id.");

export const startCallRequest = z.object({ ...target, sdp: z.string().min(1).max(20_000) });

// Issued by /api/voice/session (32 random bytes, base64url).
const callToken = z.string().min(20).max(100).regex(/^[A-Za-z0-9_-]+$/, "Invalid voice call.");

export const toolRequest = z.object({
  callToken,
  // The model's id for this tool call.
  callId: realtimeId,
  name: z.string().min(1).max(64),
  // The model's raw JSON arguments; the tool validates their content.
  arguments: z.string().max(8_000),
});

export const itemRequest = z.object({
  callToken,
  itemId: realtimeId,
  role: z.enum(["user", "assistant"]),
  transcript: z.string().max(8_000).optional(),
  toolCallIds: z.array(realtimeId).max(20).optional(),
});

export const MAX_VOICE_BODY_BYTES = 32 * 1024;
