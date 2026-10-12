import { z } from "zod";
import { readJsonCapped } from "@/lib/http";
import { enforce, ipLimit, LIMITS } from "@/lib/rate-limit";
import { BUSINESS_SLUG, MAX_MESSAGE_CHARS, MAX_SLUG_CHARS } from "@/lib/chat/limits";
import { ChatHttpError, loadHistory, prepareChatTurn, replayEvents, runChatTurn, type ChatEvent } from "@/lib/chat/turn";

// POST /api/chat   { businessSlug, sessionId, clientMessageId, message } -> NDJSON event stream
// GET  /api/chat?business=...&sessionId=...                               -> { messages }
//
// Streaming format: one JSON object per line (NDJSON). EventSource can't send
// a POST body, and NDJSON is trivial to parse from fetch().body.

const MAX_BODY_BYTES = 16 * 1024;

// Same shape as the slugs in the businesses table; anything else can't match.
const businessSlug = z.string().max(MAX_SLUG_CHARS, "Unknown business.").regex(BUSINESS_SLUG, "Unknown business.");

const chatRequest = z.object({
  businessSlug,
  sessionId: z.uuid("sessionId must be a UUID"),
  clientMessageId: z.uuid("clientMessageId must be a UUID"),
  message: z
    .string()
    .trim()
    .min(1, "Message can't be empty.")
    .max(MAX_MESSAGE_CHARS, `Messages are limited to ${MAX_MESSAGE_CHARS} characters.`),
});

const NDJSON_HEADERS = { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" };

export async function POST(request: Request) {
  const body = await readJsonCapped(request, MAX_BODY_BYTES);
  if (!body.ok) return Response.json({ error: body.error }, { status: body.status });
  const parsed = chatRequest.safeParse(body.value);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }
  const input = parsed.data;

  let prepared: Awaited<ReturnType<typeof prepareChatTurn>>;
  try {
    await enforce([LIMITS.chatSession(input.sessionId), LIMITS.chatBusiness(input.businessSlug), ...ipLimit(request, LIMITS.chatIp)]);
    prepared = await prepareChatTurn(input);
  } catch (err) {
    if (err instanceof ChatHttpError) return Response.json({ error: err.message }, { status: err.status });
    console.error("[chat] prepare failed", err);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }

  const encoder = new TextEncoder();
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // If the customer closes the tab, keep going: the reply is still saved,
      // and a retry with the same clientMessageId replays it.
      const emit = (event: ChatEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          open = false;
        }
      };
      try {
        if (prepared.kind === "replay") {
          for (const event of replayEvents(prepared.userMessageId, prepared.reply)) emit(event);
        } else {
          await runChatTurn(prepared, input, emit);
        }
      } catch (err) {
        console.error("[chat] turn failed", err);
        emit({ type: "error", message: "Something went wrong. Please try again.", retryable: true });
      } finally {
        if (open) {
          try {
            controller.close();
          } catch {
            // Already closed by a disconnect between the last event and here.
          }
        }
      }
    },
    cancel() {
      // Client went away; the turn finishes and persists on its own.
      open = false;
    },
  });
  return new Response(stream, { headers: NDJSON_HEADERS });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const sessionId = params.get("sessionId") ?? "";
  const slug = businessSlug.safeParse(params.get("business") ?? "");
  if (!slug.success) return Response.json({ error: "Unknown business." }, { status: 400 });
  if (!z.uuid().safeParse(sessionId).success) {
    return Response.json({ error: "sessionId must be a UUID" }, { status: 400 });
  }
  try {
    return Response.json({ messages: await loadHistory(slug.data, sessionId) }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof ChatHttpError) return Response.json({ error: err.message }, { status: err.status });
    console.error("[chat] history failed", err);
    return Response.json({ error: "Couldn't load the conversation." }, { status: 500 });
  }
}
