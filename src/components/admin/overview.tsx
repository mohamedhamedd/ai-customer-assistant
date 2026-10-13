"use client";

import { Check, Loader2, PhoneCall } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Issue, KnowledgeGap } from "@/lib/admin/conversations";
import type { FollowUpRow, LeadRow, RequestRow } from "@/lib/admin/crm";
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
  knowledgeGaps: KnowledgeGap[];
  issues7d: number;
  recentIssues: Issue[];
  followUps: FollowUpRow[];
  openFollowUps: number;
}


// The admin's landing page: the week at a glance and what's new.
export function Overview({ slug, timeZone }: { slug: string; timeZone: string }) {
  const api = `/api/admin/${encodeURIComponent(slug)}`;
  const [data, setData] = useState<OverviewData | null>(null);
  const [failed, setFailed] = useState(false);
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  // Done: off the list (the lead keeps it, marked done).
  const markDone = async (id: string) => {
    setBusy(id);
    try {
      const res = await fetch(`${api}/follow-ups/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "done" }) });
      if (res.ok) setDoneIds((ids) => new Set(ids).add(id));
    } finally {
      setBusy(null);
    }
  };

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
                <Kpi label="Conversations · 7 days" value={data.conversations7d} hint="With a message in the last 7 days" />
                <Kpi label="Leads · 7 days" value={data.leads7d} />
                <Kpi label="Pending consultations" value={data.pendingRequests} href={`${base}/consultations`} />
                <Kpi label="Documents ready" value={data.documentsReady} suffix={`of ${data.documentsTotal}`} href={`${base}/knowledge-base`} />
              </section>
              <Panel
                title="Needs follow-up"
                subtitle={`Customers who asked the team to contact them. Open: ${Math.max(0, data.openFollowUps - doneIds.size)}.`}
                href={`${base}/leads`}
                linkLabel="Leads"
                empty="Nothing waiting: no customer has asked to be contacted."
              >
                {data.followUps
                  .filter((f) => !doneIds.has(f.id))
                  .map((f) => (
                    <li key={f.id} className="flex flex-col gap-2 px-5 py-3 text-[14px] sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <PhoneCall aria-hidden className="mt-0.5 size-4 shrink-0 text-info" />
                        <div className="min-w-0">
                          <p className="break-words">
                            <span className="font-medium">{f.customer}</span>
                            <span className="text-text-muted"> · {f.reason}</span>
                          </p>
                          <p className="mt-0.5 text-[12px] text-text-muted">
                            <time title={new Date(f.requestedAt).toLocaleString()}>{relativeTime(f.requestedAt)}</time>
                            {f.conversationId && (
                              <>
                                {" · "}
                                <Link href={`${base}/conversations?c=${f.conversationId}`} className="hover:text-text hover:underline">
                                  View conversation
                                </Link>
                              </>
                            )}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => markDone(f.id)}
                        disabled={busy === f.id}
                        aria-label={`Mark ${f.customer}'s follow-up done`}
                        className="inline-flex h-8 shrink-0 items-center gap-1.5 self-start rounded-lg border border-border px-2.5 text-[13px] font-medium hover:bg-surface-muted disabled:opacity-50 sm:self-auto"
                      >
                        {busy === f.id ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <Check aria-hidden className="size-3.5" />}
                        Done
                      </button>
                    </li>
                  ))}
              </Panel>
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
              <Panel
                title="Questions the assistant couldn't answer"
                subtitle="Searches that found nothing in the documents: add the answers to the knowledge base."
                href={`${base}/knowledge-base`}
                linkLabel="Knowledge base"
                empty="None yet: every search found an answer."
              >
                {data.knowledgeGaps.map((g) => (
                  <li key={g.id}>
                    <Link
                      href={`${base}/conversations?c=${g.conversationId}`}
                      className="flex min-h-12 items-center justify-between gap-3 px-5 py-2 text-[14px] hover:bg-surface-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                    >
                      <span className="min-w-0 truncate">
                        <span className="font-medium">
                          &ldquo;<bdi>{g.query}</bdi>&rdquo;
                        </span>
                        <span className="text-text-muted"> · View conversation</span>
                      </span>
                      <time className="shrink-0 text-[12px] text-text-muted" title={new Date(g.askedAt).toLocaleString()}>
                        {relativeTime(g.askedAt)}
                      </time>
                    </Link>
                  </li>
                ))}
              </Panel>
              <Panel
                title="Issues"
                subtitle={`Answers the answer check replaced, and saves that failed. Last 7 days: ${data.issues7d}.`}
                href={`${base}/conversations?issues=1`}
                linkLabel="All issues"
                empty="No issues yet."
              >
                {data.recentIssues.map((issue) => (
                  <li key={`${issue.kind}:${issue.conversationId}:${issue.at}`}>
                    <Link
                      href={`${base}/conversations?c=${issue.conversationId}`}
                      className="flex min-h-12 items-center justify-between gap-3 px-5 py-2 text-[14px] hover:bg-surface-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                    >
                      <span className="min-w-0 truncate">
                        <span className="font-medium">{issue.label}</span>
                        <span className="text-text-muted"> · View conversation</span>
                      </span>
                      <time className="shrink-0 text-[12px] text-text-muted" title={new Date(issue.at).toLocaleString()}>
                        {relativeTime(issue.at)}
                      </time>
                    </Link>
                  </li>
                ))}
              </Panel>
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

function Panel({
  title,
  subtitle,
  href,
  linkLabel = "View all",
  empty,
  children,
}: {
  title: string;
  subtitle?: string;
  href: string;
  linkLabel?: string;
  empty: string;
  children: React.ReactNode[];
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[12px] text-text-muted">{subtitle}</p>}
        </div>
        <Link href={href} className="shrink-0 text-[12px] font-medium text-accent hover:underline">
          {linkLabel}
        </Link>
      </div>
      {children.length === 0 ? <p className="px-5 py-4 text-[14px] text-text-muted">{empty}</p> : <ul className="divide-y divide-border">{children}</ul>}
    </section>
  );
}
