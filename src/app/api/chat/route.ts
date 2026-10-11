import { z } from "zod";
import { ChatHttpError, loadHistory, prepareChatTurn, replayEvents, runChatTurn, type ChatEvent } from "@/lib/chat/turn";

// POST /api/chat   { sessionId, clientMessageId, message } -> NDJSON event stream
// GET  /api/chat?sessionId=...                                -> { messages }
//
// Streaming format: one JSON object per line (NDJSON). EventSource can't send
// a POST body, and NDJSON is trivial to parse from fetch().body.

export const MAX_MESSAGE_CHARS = 2000;
const MAX_BODY_BYTES = 16 * 1024;

const chatRequest = z.object({
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

// Reads at most maxBytes, whatever the headers say: a chunked request has no
// content-length, and request.json() would buffer an unlimited body.
type JsonBody = { ok: true; value: unknown } | { ok: false; status: 400 | 413; error: string };
async function readJsonCapped(request: Request, maxBytes: number): Promise<JsonBody> {
  const tooLarge: JsonBody = { ok: false, status: 413, error: "Request is too large." };
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) return tooLarge;
  const reader = request.body?.getReader();
  if (!reader) return { ok: false, status: 400, error: "Request body must be JSON." };
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return tooLarge;
    }
    chunks.push(value);
  }
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { ok: false, status: 400, error: "Request body must be JSON." };
  }
}

export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("sessionId") ?? "";
  if (!z.uuid().safeParse(sessionId).success) {
    return Response.json({ error: "sessionId must be a UUID" }, { status: 400 });
  }
  try {
    return Response.json({ messages: await loadHistory(sessionId) }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof ChatHttpError) return Response.json({ error: err.message }, { status: err.status });
    console.error("[chat] history failed", err);
    return Response.json({ error: "Couldn't load the conversation." }, { status: 500 });
  }
}
