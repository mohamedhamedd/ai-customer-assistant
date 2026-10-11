import { redirect } from "next/navigation";
import { connection } from "next/server";
import { env } from "@/lib/env";

// Until the home page lists every business (PR-15), / opens the demo one.
// Nothing to show while it resolves, so blocking is fine (no Suspense shell).
export const instant = false;

export default async function Home() {
  await connection(); // read the slug at request time, not at build
  redirect(`/b/${env().DEMO_BUSINESS_SLUG}`);
}
