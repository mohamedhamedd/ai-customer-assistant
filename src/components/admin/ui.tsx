"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ConsultationStatus } from "@/lib/db/enums";

// Small shared pieces of the admin UI.

export function Badge({ tone, children }: { tone: "success" | "danger" | "info" | "warning" | "neutral"; children: React.ReactNode }) {
  const tones = {
    success: "bg-success/10 text-success",
    danger: "bg-danger/10 text-danger",
    info: "bg-info/10 text-info",
    warning: "bg-warning/10 text-warning",
    neutral: "bg-surface-muted text-text-muted",
  };
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ${tones[tone]}`}>{children}</span>;
}

// Fired after a status change, so the sidebar's pending badge refreshes.
export const CONSULTATIONS_CHANGED = "admin:consultations-changed";

export const STATUS_LABEL: Record<ConsultationStatus, string> = { pending: "Pending", confirmed: "Confirmed", cancelled: "Cancelled" };
export const STATUS_TONE = { pending: "warning", confirmed: "success", cancelled: "danger" } as const;

export function StatusBadge({ status }: { status: ConsultationStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

// Closes on Escape (unless `busy`), focuses the panel on open, and gives
// focus back to what opened it (or to `fallback` if that's gone).
export function useDialog(onClose: () => void, opts: { busy?: boolean; fallback?: () => HTMLElement | null } = {}) {
  const panel = useRef<HTMLDivElement>(null);
  const latest = useRef({ onClose, opts });
  useEffect(() => {
    latest.current = { onClose, opts };
  });
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !latest.current.opts.busy) latest.current.onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const target = opener?.isConnected ? opener : latest.current.opts.fallback?.();
      target?.focus();
    };
  }, []);
  return panel;
}

// One message at a time, bottom right, gone after a few seconds.
export function useToast() {
  const [toast, setToast] = useState<{ text: string; tone: "success" | "danger"; key: number } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  const show = useCallback((text: string, tone: "success" | "danger" = "success") => setToast({ text, tone, key: Date.now() }), []);
  const element = (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50">
      {toast && (
        <p
          key={toast.key}
          role={toast.tone === "danger" ? "alert" : "status"}
          className={`rounded-lg border px-4 py-2.5 text-[14px] font-medium shadow-level-2 ${
            toast.tone === "danger" ? "border-danger/40 bg-surface text-danger" : "border-border bg-surface text-text"
          }`}
        >
          {toast.text}
        </p>
      )}
    </div>
  );
  return { show, element };
}
