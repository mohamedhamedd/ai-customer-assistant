import type { Metadata } from "next";
import { connection } from "next/server";
import { NewBusiness } from "@/components/admin/new-business";

// /admin/new: create a business (US-10.2). A static segment, so it wins over
// /admin/[slug]; "new" is a reserved slug for that reason.
export const metadata: Metadata = { title: "New business · Admin", robots: { index: false } };
export const instant = false;

export default async function NewBusinessPage() {
  await connection();
  return <NewBusiness />;
}
