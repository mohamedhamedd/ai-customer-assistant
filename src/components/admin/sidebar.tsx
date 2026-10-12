"use client";

import { CalendarDays, FileText, LayoutDashboard, MessagesSquare, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CONSULTATIONS_CHANGED } from "./ui";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

// Only pages that exist are listed: Settings and the business switcher
// come with PR-15.
const NAV = [
  { href: "overview", label: "Overview", icon: LayoutDashboard },
  { href: "knowledge-base", label: "Knowledge base", icon: FileText },
  { href: "leads", label: "Leads", icon: Users },
  { href: "consultations", label: "Consultations", icon: CalendarDays },
  { href: "conversations", label: "Conversations", icon: MessagesSquare },
];

// Pending requests, for the badge: refreshed on navigation and whenever the
// consultations page changes a status.
function usePendingCount(slug: string, pathname: string) {
  const [pending, setPending] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch(`/api/admin/${encodeURIComponent(slug)}/consultations?counts=1`, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : Promise.reject()))
        .then((body: { counts: { pending: number } }) => live && setPending(body.counts.pending))
        .catch(() => {});
    void load();
    window.addEventListener(CONSULTATIONS_CHANGED, load);
    return () => {
      live = false;
      window.removeEventListener(CONSULTATIONS_CHANGED, load);
    };
  }, [slug, pathname]);
  return pending;
}

// 240 px with labels from 1280 px, an icon rail below (design: Layout).
export function AdminSidebar({ business }: { business: { slug: string; name: string } }) {
  const pathname = usePathname();
  const pending = usePendingCount(business.slug, pathname);
  return (
    <aside className="flex w-16 shrink-0 flex-col justify-between border-r border-border bg-surface p-3 xl:w-[240px]">
      <div className="flex flex-col gap-4">
        <div title={business.name} className="flex items-center gap-2 rounded-lg border border-border px-2 py-2 xl:px-3">
          <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-[12px] font-semibold text-accent-contrast">
            {initials(business.name)}
          </span>
          <span className="hidden truncate text-[14px] font-semibold xl:inline">{business.name}</span>
        </div>
        <nav aria-label="Admin" className="flex flex-col gap-1">
          {NAV.map(({ href, label, icon: Icon }) => {
            const path = `/admin/${business.slug}/${href}`;
            const active = pathname === path;
            return (
              <Link
                key={href}
                href={path}
                aria-current={active ? "page" : undefined}
                title={label}
                className={`flex h-10 items-center justify-center gap-3 rounded-lg px-3 text-[14px] xl:justify-start ${
                  active ? "bg-surface-muted font-semibold text-text" : "text-text-muted hover:bg-surface-muted hover:text-text"
                }`}
              >
                <span className="relative shrink-0">
                  <Icon aria-hidden className={`size-5 ${active ? "text-accent" : ""}`} />
                  {href === "consultations" && !!pending && <span aria-hidden className="absolute -right-1 -top-1 size-2 rounded-full bg-warning xl:hidden" />}
                </span>
                <span className="hidden flex-1 xl:inline">{label}</span>
                {href === "consultations" && !!pending && (
                  <span className="hidden rounded-full bg-surface-muted px-2 py-0.5 text-[12px] font-medium text-text-muted xl:inline">
                    {pending}
                    <span className="sr-only"> pending</span>
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>
      <p className="flex items-center justify-center gap-1.5 rounded bg-surface-muted px-2 py-1 text-[12px] text-text-muted xl:justify-start" title="Demo mode · no login">
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-text-muted" />
        <span className="hidden xl:inline">Demo mode · no login</span>
      </p>
    </aside>
  );
}
