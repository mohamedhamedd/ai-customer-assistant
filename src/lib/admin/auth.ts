import "server-only";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { ChatHttpError } from "@/lib/chat/turn";
import { verifySession } from "./session";

// Who may use the admin (pages and /api/admin/*):
//   "password": ADMIN_PASSWORD is set; a signed session cookie is required.
//   "open":     no password and `next dev`: the local demo, labelled as such.
//   "locked":   no password in a production build: nobody, until it is set.
export type AdminMode = "password" | "open" | "locked";

export const ADMIN_COOKIE = "admin_session";

export function adminMode(): AdminMode {
  if (env().ADMIN_PASSWORD) return "password";
  return process.env.NODE_ENV === "development" ? "open" : "locked";
}

export async function isAdmin(): Promise<boolean> {
  const mode = adminMode();
  if (mode === "open") return true;
  if (mode === "locked") return false;
  return verifySession((await cookies()).get(ADMIN_COOKIE)?.value, env().ADMIN_PASSWORD!);
}

// For the admin API routes: 401 without a valid session, 503 when locked.
export async function requireAdmin(): Promise<void> {
  if (adminMode() === "locked") throw new ChatHttpError(503, "The admin is disabled until ADMIN_PASSWORD is set.");
  if (!(await isAdmin())) throw new ChatHttpError(401, "Sign in to the admin first.");
}
