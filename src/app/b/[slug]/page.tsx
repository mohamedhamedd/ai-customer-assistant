import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Chat } from "@/components/chat/chat";
import { findBusiness } from "@/lib/chat/turn";

// /b/[slug]: the chat for one business (D-14). The business's name comes from
// the database, so the same page serves any business.
//
// An unknown slug renders the not-found page with status 200: the static
// shell has already streamed when the lookup runs, and Next adds a noindex
// tag. A real 404 would need a database lookup in Proxy on every page load;
// the chat API itself returns a true 404.

async function businessFor(params: PageProps<"/b/[slug]">["params"]) {
  await connection(); // per request, not prerendered
  return findBusiness((await params).slug);
}

export async function generateMetadata({ params }: PageProps<"/b/[slug]">): Promise<Metadata> {
  const business = await businessFor(params);
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
  const business = await businessFor(params);
  if (!business) notFound();
  // Only what the browser needs: no ids or settings.
  return <Chat business={{ slug: business.slug, name: business.name }} />;
}
