import { Sparkles } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { listBusinesses } from "@/lib/admin/businesses";

// Home (US-10.2): one card per business, each opening its own chat. A demo
// device: in production a customer reaches a business's chat from that
// business's website, never from a list of every business.
export const instant = false;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

export default async function Home() {
  await connection(); // per request: a business created a moment ago is listed
  const businesses = await listBusinesses();
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="h-16 shrink-0 border-b border-border bg-surface">
        <div className="mx-auto flex h-full max-w-[1040px] items-center justify-between px-4 md:px-6">
          <span className="flex items-center gap-3">
            <span aria-hidden className="flex size-7 items-center justify-center rounded-lg bg-accent text-accent-contrast">
              <Sparkles className="size-4" />
            </span>
            <span className="text-[16px] font-semibold">AI Customer Assistant</span>
          </span>
          <Link href="/admin" className="rounded px-2 py-1 text-[14px] font-medium text-text-muted hover:bg-surface-muted hover:text-text">
            Admin ↗
          </Link>
        </div>
      </header>
      <main className="flex-1">
        <div className="mx-auto max-w-[1040px] px-4 pb-20 pt-12 md:px-6 md:pt-16">
          <h1 className="text-[30px] font-semibold leading-tight">Choose a business</h1>
          <p className="mt-2 text-[16px] text-text-muted">Each business has its own assistant, which answers only from that business&apos;s documents.</p>

          {businesses.length === 0 ? (
            <section className="mt-8 rounded-2xl border border-border bg-surface p-12 text-center">
              <p className="text-[14px] text-text-muted">No businesses yet.</p>
              <Link href="/admin/new" className="mt-3 inline-block text-[14px] font-medium text-accent hover:underline">
                Create one in the admin
              </Link>
            </section>
          ) : (
            <ul className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-3">
              {businesses.map((b) => (
                <li key={b.slug}>
                  <Link
                    href={`/b/${b.slug}`}
                    className="group flex h-full flex-col justify-between rounded-2xl border border-border bg-surface p-6 transition-shadow hover:border-text-muted/40 hover:shadow-level-2 focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    <div>
                      <span aria-hidden className="flex size-11 items-center justify-center rounded-full bg-accent text-[16px] font-medium text-accent-contrast">
                        {initials(b.name)}
                      </span>
                      <h2 className="mt-5 text-[18px] font-semibold group-hover:text-accent">{b.name}</h2>
                      {b.description && <p className="mt-2 line-clamp-2 text-[14px] text-text-muted">{b.description}</p>}
                    </div>
                    <div className="mt-6 flex items-center justify-between border-t border-border pt-6">
                      <span className="text-[12px] text-text-muted">
                        {b.documents === 0 ? "No documents yet" : `${b.documents} ${b.documents === 1 ? "document" : "documents"}`}
                      </span>
                      <span className="text-[14px] font-medium text-accent">
                        Open chat <span aria-hidden>→</span>
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-12 text-center text-[12px] text-text-muted">Demo mode · no login. In production, customers open a business&apos;s chat from its own website.</p>
        </div>
      </main>
    </div>
  );
}
