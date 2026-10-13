import "server-only";
import { ChatHttpError, requireBusiness, type Business } from "@/lib/chat/turn";
import { readJsonCapped } from "@/lib/http";
import { ProfileError } from "./businesses";
import { ServicesError } from "./services";

// Shared shape of the admin routes: known errors keep their status (a form
// error also says which fields), anything else is a logged 500.
//
// No login (assumption A1, "Demo mode"): these routes are open to anyone
// who can reach the server. See README, Security model.
export async function respond(label: string, run: () => Promise<Response>) {
  try {
    return await run();
  } catch (err) {
    if (err instanceof ProfileError) return Response.json({ error: err.message, fields: err.fields }, { status: err.status });
    if (err instanceof ServicesError) return Response.json({ error: err.message, rows: err.rows }, { status: err.status });
    if (err instanceof ChatHttpError) return Response.json({ error: err.message }, { status: err.status });
    console.error(`[admin] ${label} failed`, err);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

// For routes under /api/admin/[slug]: the business comes from the URL (an
// unknown slug is a 404 before anything runs).
export function withBusiness(params: Promise<{ slug: string }>, label: string, run: (business: Business) => Promise<Response>) {
  return respond(label, async () => run(await requireBusiness((await params).slug)));
}

// A JSON body, read with a cap.
export async function jsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const body = await readJsonCapped(request, maxBytes);
  if (!body.ok) throw new ChatHttpError(body.status, body.error);
  return body.value;
}
