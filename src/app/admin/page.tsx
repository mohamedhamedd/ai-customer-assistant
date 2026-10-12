import { redirect } from "next/navigation";
import { connection } from "next/server";
import { env } from "@/lib/env";

// Until the admin has a business switcher (PR-15), /admin opens the demo
// business. Admin URLs carry the business (/admin/[slug]/…) from day one.
export const instant = false;

export default async function AdminHome() {
  await connection();
  redirect(`/admin/${env().DEMO_BUSINESS_SLUG}/knowledge-base`);
}
