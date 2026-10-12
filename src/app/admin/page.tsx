import { redirect } from "next/navigation";
import { connection } from "next/server";
import { listBusinesses } from "@/lib/admin/businesses";
import { env } from "@/lib/env";

// /admin opens a business's overview: the demo one if it exists, else the
// first, else the New business page (an empty database).
export const instant = false;

export default async function AdminHome() {
  await connection();
  const businesses = await listBusinesses();
  const target = businesses.find((b) => b.slug === env().DEMO_BUSINESS_SLUG) ?? businesses[0];
  redirect(target ? `/admin/${target.slug}/overview` : "/admin/new");
}
