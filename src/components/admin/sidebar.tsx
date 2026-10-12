"use client";

import { FileText } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

// Only pages that exist are listed; Overview, Leads and Consultations come
// with PR-11, Conversations with PR-12, Settings and the switcher with PR-15.
const NAV = [{ href: "knowledge-base", label: "Knowledge base", icon: FileText }];

// 240 px with labels from 1280 px, an icon rail below (design: Layout).
export function AdminSidebar({ business }: { business: { slug: string; name: string } }) {
  const pathname = usePathname();
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
                <Icon aria-hidden className={`size-5 shrink-0 ${active ? "text-accent" : ""}`} />
                <span className="hidden xl:inline">{label}</span>
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
