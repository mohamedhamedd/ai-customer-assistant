import "server-only";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { findBusiness } from "@/lib/chat/turn";

// The business an admin page is for, from the slug in its URL. Per request
// (connection()), and a 404 for an unknown slug. What the browser needs only.
export async function adminBusiness(params: Promise<{ slug: string }>) {
  await connection();
  const business = await findBusiness((await params).slug);
  if (!business) notFound();
  return { slug: business.slug, name: business.name, timeZone: business.timezone };
}
