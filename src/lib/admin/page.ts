import "server-only";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { findBusiness } from "@/lib/chat/turn";

// The business an admin page is for, from the slug in its URL. Per request
// (connection()), a 404 for an unknown slug, and only what the browser needs.
export async function adminBusiness(params: Promise<{ slug: string }>) {
  await connection();
  const business = await findBusiness((await params).slug);
  if (!business) notFound();
  return { slug: business.slug, name: business.name, timeZone: business.timezone };
}
