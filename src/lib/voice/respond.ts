import type { z } from "zod";
import { ChatHttpError } from "@/lib/chat/turn";
import { readJsonCapped } from "@/lib/http";
import { MAX_VOICE_BODY_BYTES } from "./requests";

// Shared shape of the voice routes: capped JSON body, zod validation, known
// errors as their status, anything else a logged 500.
export async function handleVoice<T>(request: Request, schema: z.ZodType<T>, label: string, run: (input: T) => Promise<Response>) {
  const body = await readJsonCapped(request, MAX_VOICE_BODY_BYTES);
  if (!body.ok) return Response.json({ error: body.error }, { status: body.status });
  const parsed = schema.safeParse(body.value);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  try {
    return await run(parsed.data);
  } catch (err) {
    if (err instanceof ChatHttpError) return Response.json({ error: err.message }, { status: err.status });
    console.error(`[voice] ${label} failed`, err);
    return Response.json({ error: "Something went wrong with voice. Please try again." }, { status: 500 });
  }
}
