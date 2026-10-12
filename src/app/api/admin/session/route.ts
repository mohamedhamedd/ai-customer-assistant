import { cookies } from "next/headers";
import { z } from "zod";
import { ADMIN_COOKIE, adminMode } from "@/lib/admin/auth";
import { sameSecret, SESSION_TTL_MS, signSession } from "@/lib/admin/session";
import { env } from "@/lib/env";
import { readJsonCapped } from "@/lib/http";

// POST   /api/admin/session { password } -> 204 + session cookie
// DELETE /api/admin/session              -> 204, cookie cleared
//
// The cookie is httpOnly (no script can read it) and SameSite=Lax, so other
// sites can't make the browser send it with a POST, PATCH or DELETE.

const body = z.object({ password: z.string().max(200) });

export async function POST(request: Request) {
  if (adminMode() !== "password") return Response.json({ error: "Sign-in isn't enabled: ADMIN_PASSWORD is not set." }, { status: 503 });
  const json = await readJsonCapped(request, 1024);
  const parsed = json.ok ? body.safeParse(json.value) : null;
  if (!parsed?.success || !sameSecret(parsed.data.password, env().ADMIN_PASSWORD!)) {
    // No hint about which part was wrong. Rate limiting comes with PR-13.
    return Response.json({ error: "That password isn't right." }, { status: 401 });
  }
  (await cookies()).set(ADMIN_COOKIE, signSession(env().ADMIN_PASSWORD!), {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return new Response(null, { status: 204 });
}

export async function DELETE() {
  (await cookies()).delete(ADMIN_COOKIE);
  return new Response(null, { status: 204 });
}
