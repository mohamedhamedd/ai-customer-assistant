import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Chat } from "@/components/chat/chat";
import { findBusiness } from "@/lib/chat/turn";

// /b/[slug]: the chat for one business (D-14). The business's name comes from
// the database, so the same page serves any business.

// The lookup is per request (it reads the database through a short in-memory
// cache): connection() tells Next not to prerender it.
export async function generateMetadata({ params }: PageProps<"/b/[slug]">): Promise<Metadata> {
  await connection();
  const business = await findBusiness((await params).slug);
  if (!business) return { title: "Assistant not found" };
  return { title: `${business.name} · AI assistant`, description: business.description };
}

export default function Page({ params }: PageProps<"/b/[slug]">) {
  // The shell streams first; the business streams in with the chat.
  return (
    <Suspense fallback={<div className="h-dvh bg-bg" />}>
      <BusinessChat params={params} />
    </Suspense>
  );
}

async function BusinessChat({ params }: Pick<PageProps<"/b/[slug]">, "params">) {
  await connection();
  const business = await findBusiness((await params).slug);
  if (!business) notFound();
  // Only what the browser needs: no ids or settings.
  return <Chat business={{ slug: business.slug, name: business.name }} />;
}
