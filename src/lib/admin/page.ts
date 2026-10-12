import "server-only";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { findBusiness } from "@/lib/chat/turn";
import { adminMode, isAdmin } from "./auth";

// The business an admin page is for, from the slug in its URL, for a
// signed-in admin (otherwise: the sign-in page). Per request (connection()),
// a 404 for an unknown slug, and only what the browser needs.
export async function adminBusiness(params: Promise<{ slug: string }>) {
  await connection();
  if (!(await isAdmin())) redirect("/admin/login");
  const business = await findBusiness((await params).slug);
  if (!business) notFound();
  return { slug: business.slug, name: business.name, timeZone: business.timezone, mode: adminMode() };
}
