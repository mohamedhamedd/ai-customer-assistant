"use client";

import { Check, Copy, Loader2, Mic, MessageSquare, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { RequestRow } from "@/lib/admin/crm";
import type { Channel } from "@/lib/db/enums";
import { formatInZone, relativeTime } from "./format";
import { StatusBadge, useDialog } from "./ui";

interface LeadDetail {
  lead: { id: string; name: string; email: string | null; phone: string | null; interest: string | null; channel: Channel; capturedAt: string };
  requests: RequestRow[];
}

// A lead and its consultation requests (US-8.1), opened from the leads or
// the consultations table.
export function LeadDrawer({ api, leadId, timeZone, onClose }: { api: string; leadId: string; timeZone: string; onClose: () => void }) {
  const panel = useDialog(onClose);
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`${api}/leads/${leadId}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((body: LeadDetail) => live && setDetail(body))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [api, leadId]);

  const lead = detail?.lead;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lead-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-[440px] flex-col border-l border-border bg-surface shadow-level-2 outline-none"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border p-5">
          <div className="min-w-0">
            <h2 id="lead-title" className="text-[18px] font-semibold break-words">
              {lead?.name ?? "Lead"}
            </h2>
            {lead && (
              <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-text-muted">
                {lead.channel === "voice" ? <Mic aria-hidden className="size-3.5" /> : <MessageSquare aria-hidden className="size-3.5" />}
                Captured by {lead.channel} · <time title={new Date(lead.capturedAt).toLocaleString()}>{relativeTime(lead.capturedAt)}</time>
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-surface-muted hover:text-text">
            <X aria-hidden className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {failed && <p className="text-[14px] text-danger">Couldn&apos;t load this lead.</p>}
          {!detail && !failed && (
            <p className="flex items-center gap-2 text-[14px] text-text-muted">
              <Loader2 aria-hidden className="size-4 animate-spin" /> Loading…
            </p>
          )}
          {lead && detail && (
            <div className="flex flex-col gap-6">
              <section>
                <h3 className="text-[12px] font-medium text-text-muted">Contact</h3>
                <dl className="mt-2 flex flex-col gap-2 text-[14px]">
                  {lead.email && <CopyRow label="Email" value={lead.email} />}
                  {lead.phone && <CopyRow label="Phone" value={lead.phone} />}
                </dl>
              </section>
              {lead.interest && (
                <section>
                  <h3 className="text-[12px] font-medium text-text-muted">Interest</h3>
                  <p className="mt-1 text-[14px] break-words">{lead.interest}</p>
                </section>
              )}
              <section>
                <h3 className="text-[12px] font-medium text-text-muted">Consultation requests</h3>
                {detail.requests.length === 0 ? (
                  <p className="mt-1 text-[14px] text-text-muted">None yet.</p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-2">
                    {detail.requests.map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3 text-[14px]">
                        <div className="min-w-0">
                          <p className="font-medium break-words">{r.service}</p>
                          <p className="text-[13px] text-text-muted">{formatInZone(r.preferredAt, timeZone)}</p>
                        </div>
                        <StatusBadge status={r.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <dt className="sr-only">{label}</dt>
        <dd className="break-all">{value}</dd>
      </div>
      <button type="button" onClick={copy} aria-label={`Copy ${label.toLowerCase()}`} title={`Copy ${label.toLowerCase()}`} className="inline-flex size-8 shrink-0 items-center justify-center rounded text-text-muted hover:bg-surface-muted hover:text-text">
        {copied ? <Check aria-hidden className="size-4 text-success" /> : <Copy aria-hidden className="size-4" />}
      </button>
    </div>
  );
}
