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

export const toolRequest = z.object({
  ...target,
  name: z.string().min(1).max(64),
  // The model's raw JSON arguments; the tool validates their content.
  arguments: z.string().max(8_000),
});

export const itemRequest = z.object({
  ...target,
  itemId: realtimeId,
  role: z.enum(["user", "assistant"]),
  transcript: z.string().max(8_000).optional(),
});

export const MAX_VOICE_BODY_BYTES = 32 * 1024;
