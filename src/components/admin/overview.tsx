"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { LeadRow, RequestRow } from "@/lib/admin/crm";
import { maskEmail, maskPhone } from "@/components/chat/thread";
import { formatInZone, relativeTime } from "./format";
import { AdminHeader } from "./header";
import { StatusBadge } from "./ui";

interface OverviewData {
  conversations7d: number;
  leads7d: number;
  pendingRequests: number;
  documentsReady: number;
  documentsTotal: number;
  recentRequests: RequestRow[];
  recentLeads: LeadRow[];
}

// The admin's landing page: the week at a glance and what's new.
export function Overview({ slug, timeZone }: { slug: string; timeZone: string }) {
  const api = `/api/admin/${encodeURIComponent(slug)}`;
  const [data, setData] = useState<OverviewData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`${api}/overview`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((body: OverviewData) => live && setData(body))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [api]);

  const base = `/admin/${slug}`;
  return (
    <>
      <AdminHeader title="Overview" slug={slug} />
      <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-6">
          {failed && <p className="text-[14px] text-danger">Couldn&apos;t load the overview.</p>}
          {!data && !failed && (
            <p className="flex items-center gap-2 text-[14px] text-text-muted">
              <Loader2 aria-hidden className="size-4 animate-spin" /> Loading…
            </p>
          )}
          {data && (
            <>
              <section aria-label="This week" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Kpi label="Conversations · 7 days" value={data.conversations7d} hint="Started in the last 7 days" />
                <Kpi label="Leads · 7 days" value={data.leads7d} />
                <Kpi label="Pending consultations" value={data.pendingRequests} href={`${base}/consultations`} />
                <Kpi label="Documents ready" value={data.documentsReady} suffix={`of ${data.documentsTotal}`} href={`${base}/knowledge-base`} />
              </section>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Panel title="Recent consultation requests" href={`${base}/consultations`} empty="No requests yet.">
                  {data.recentRequests.map((r) => (
                    <li key={r.id} className="flex min-h-12 items-center justify-between gap-3 px-5 py-2 text-[14px]">
                      <p className="min-w-0 truncate">
                        <span className="font-medium">{r.customer}</span>
                        <span className="text-text-muted">
                          {" "}
                          · {r.service} · {formatInZone(r.preferredAt, timeZone)}
                        </span>
                      </p>
                      <StatusBadge status={r.status} />
                    </li>
                  ))}
                </Panel>
                <Panel title="Recent leads" href={`${base}/leads`} empty="No leads yet.">
                  {data.recentLeads.map((l) => (
                    <li key={l.id} className="flex min-h-12 items-center justify-between gap-3 px-5 py-2 text-[14px]">
                      <p className="min-w-0 truncate">
                        <span className="font-medium">{l.name}</span>
                        {/* Masked here: the overview is the screen most likely to be shared. */}
                        <span className="text-text-muted"> · {l.email ? maskEmail(l.email) : l.phone && maskPhone(l.phone)}</span>
                      </p>
                      <time className="shrink-0 text-[12px] text-text-muted" title={new Date(l.capturedAt).toLocaleString()}>
                        {relativeTime(l.capturedAt)}
                      </time>
                    </li>
                  ))}
                </Panel>
              </div>
            </>
          )}
        </div>
      </main>
    </>
  );
}

function Kpi({ label, value, suffix, hint, href }: { label: string; value: number; suffix?: string; hint?: string; href?: string }) {
  const body = (
    <>
      <p className="text-[14px] font-medium text-text-muted" title={hint}>
        {label}
      </p>
      <p className="mt-2 flex items-baseline gap-1.5">
        <span className="text-[30px] font-semibold leading-none tabular-nums">{value}</span>
        {suffix && <span className="text-[12px] text-text-muted">{suffix}</span>}
      </p>
    </>
  );
  const box = "rounded-2xl border border-border bg-surface p-5";
  return href ? (
    <Link href={href} className={`${box} hover:shadow-level-2 focus-visible:outline-2 focus-visible:outline-accent`}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}

function Panel({ title, href, empty, children }: { title: string; href: string; empty: string; children: React.ReactNode[] }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <h2 className="text-[14px] font-semibold">{title}</h2>
        <Link href={href} className="text-[12px] font-medium text-accent hover:underline">
          View all
        </Link>
      </div>
      {children.length === 0 ? <p className="px-5 py-4 text-[14px] text-text-muted">{empty}</p> : <ul className="divide-y divide-border">{children}</ul>}
    </section>
  );
}
