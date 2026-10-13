"use client";

import { CalendarDays, Check, ChevronsUpDown, Clock, FileText, LayoutDashboard, MessagesSquare, Plus, Settings, Tags, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CONSULTATIONS_CHANGED } from "./ui";
import { initials } from "@/lib/initials";

const NAV = [
  { href: "overview", label: "Overview", icon: LayoutDashboard },
  { href: "knowledge-base", label: "Knowledge base", icon: FileText },
  { href: "services", label: "Services", icon: Tags },
  { href: "hours", label: "Opening hours", icon: Clock },
  { href: "leads", label: "Leads", icon: Users },
  { href: "consultations", label: "Consultations", icon: CalendarDays },
  { href: "conversations", label: "Conversations", icon: MessagesSquare },
  { href: "settings", label: "Settings", icon: Settings },
];

type BusinessLink = { slug: string; name: string };

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
export function AdminSidebar({ business, businesses }: { business: BusinessLink; businesses: BusinessLink[] }) {
  const pathname = usePathname();
  const pending = usePendingCount(business.slug, pathname);
  return (
    <aside className="flex w-16 shrink-0 flex-col justify-between border-r border-border bg-surface p-3 xl:w-[240px]">
      <div className="flex flex-col gap-4">
        <BusinessSwitcher current={business} businesses={businesses} pathname={pathname} />
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

// Every admin page shows one business; this switches to another one on the
// same page (Leads stays Leads), or opens New business.
function BusinessSwitcher({ current, businesses, pathname }: { current: BusinessLink; businesses: BusinessLink[]; pathname: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  // The page after /admin/<slug>/, kept when switching.
  const page = pathname.split("/")[3] ?? "overview";

  // Closes on a click outside, on Escape (focus back on the button), and
  // when a link in it is followed.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="business-switcher"
        title={`${current.name} · switch business`}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-2 py-2 hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent xl:justify-between xl:px-2.5"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-[12px] font-semibold text-accent-contrast">
            {initials(current.name)}
          </span>
          <span className="hidden truncate text-[14px] font-semibold xl:inline">{current.name}</span>
          <span className="sr-only xl:hidden">{current.name}, switch business</span>
        </span>
        <ChevronsUpDown aria-hidden className="hidden size-4 shrink-0 text-text-muted xl:block" />
      </button>
      {open && (
        <div id="business-switcher" className="absolute left-0 top-full z-30 mt-1 w-[240px] rounded-xl border border-border bg-surface p-1 shadow-level-2">
          <p className="px-2.5 pb-1 pt-1.5 text-[12px] font-medium text-text-muted">Businesses</p>
          <ul className="max-h-72 overflow-y-auto">
            {businesses.map((b) => (
              <li key={b.slug}>
                <Link
                  href={`/admin/${b.slug}/${page}`}
                  onClick={() => setOpen(false)}
                  aria-current={b.slug === current.slug ? "true" : undefined}
                  className="flex min-h-10 items-center gap-2.5 rounded-lg px-2.5 text-[14px] hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-muted text-[11px] font-semibold">
                    {initials(b.name)}
                  </span>
                  <span className="flex-1 truncate">{b.name}</span>
                  {b.slug === current.slug && <Check aria-hidden className="size-4 shrink-0 text-accent" />}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-1 border-t border-border pt-1">
            <Link href="/admin/new" onClick={() => setOpen(false)} className="flex min-h-10 items-center gap-2.5 rounded-lg px-2.5 text-[14px] font-medium text-accent hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent">
              <Plus aria-hidden className="size-4" /> New business
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
