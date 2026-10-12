import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AdminSidebar } from "@/components/admin/sidebar";
import { findBusiness } from "@/lib/chat/turn";

// Admin shell for one business: sidebar + page. No login in this version
// (assumption A1): the sidebar says so ("Demo mode · no login").

export const metadata: Metadata = { title: "Admin · AI Customer Assistant", robots: { index: false } };

export default function AdminLayout({ params, children }: LayoutProps<"/admin/[slug]">) {
  return (
    <Suspense fallback={<div className="h-dvh bg-bg" />}>
      <Shell params={params}>{children}</Shell>
    </Suspense>
  );
}

async function Shell({ params, children }: { params: Promise<{ slug: string }>; children: React.ReactNode }) {
  await connection();
  const business = await findBusiness((await params).slug);
  if (!business) notFound();
  return (
    <div className="flex h-dvh bg-bg">
      <AdminSidebar business={{ slug: business.slug, name: business.name }} />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
