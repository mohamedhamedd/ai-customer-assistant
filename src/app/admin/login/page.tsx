import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { LoginForm } from "@/components/admin/login-form";
import { adminMode, isAdmin } from "@/lib/admin/auth";

export const metadata: Metadata = { title: "Admin sign-in", robots: { index: false } };

// Blocking (no Suspense shell): one cookie check, then the form or a redirect.
export const instant = false;

export default async function AdminLogin() {
  await connection();
  if (await isAdmin()) redirect("/admin");
  const locked = adminMode() === "locked";
  return (
    <main className="flex flex-1 items-center justify-center bg-bg p-4">
      <div className="w-full max-w-[380px] rounded-2xl border border-border bg-surface p-6">
        <h1 className="text-[18px] font-semibold">Admin sign-in</h1>
        {locked ? (
          <p className="mt-2 text-[14px] text-text-muted">The admin is disabled until ADMIN_PASSWORD is set on the server.</p>
        ) : (
          <LoginForm />
        )}
      </div>
    </main>
  );
}
