"use client";

import { FileText, Loader2, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DocumentRow } from "@/lib/admin/knowledge";

interface Section {
  index: number;
  heading: string;
  content: string;
  tokens: number;
}

// Closes on Escape and focuses the panel on open (shared by both panels).
function useDialog(onClose: () => void) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, []);
  return panel;
}

// How a document was split into sections (US-7.4), in a right-hand drawer.
export function DocumentDrawer({ api, document: doc, onClose }: { api: string; document: DocumentRow; onClose: () => void }) {
  const panel = useDialog(onClose);
  const [sections, setSections] = useState<Section[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`${api}/documents/${doc.id}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((body: { sections: Section[] }) => live && setSections(body.sections))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [api, doc.id]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-[560px] flex-col border-l border-border bg-surface shadow-level-2 outline-none"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border p-5">
          <div className="flex min-w-0 items-start gap-3">
            <FileText aria-hidden className="mt-0.5 size-5 shrink-0 text-info" />
            <div className="min-w-0">
              <h2 id="drawer-title" className="text-[16px] font-semibold break-words">
                {doc.title}
              </h2>
              <p className="mt-0.5 text-[12px] text-text-muted">
                {doc.sourceType.toUpperCase()} · {doc.sections} {doc.sections === 1 ? "section" : "sections"} · uploaded {new Date(doc.uploadedAt).toLocaleDateString()}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-surface-muted hover:text-text">
            <X aria-hidden className="size-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <p className="mb-4 text-[13px] text-text-muted">The assistant searches these sections. Each answer cites the ones it used.</p>
          {failed && <p className="text-[14px] text-danger">Couldn&apos;t load the sections.</p>}
          {!sections && !failed && (
            <p className="flex items-center gap-2 text-[14px] text-text-muted">
              <Loader2 aria-hidden className="size-4 animate-spin" /> Loading sections…
            </p>
          )}
          <ol className="flex flex-col gap-3">
            {sections?.map((s) => (
              <li key={s.index} className="rounded-xl border border-border p-4">
                <details>
                  <summary className="cursor-pointer text-[14px] font-medium">
                    <span className="mr-2 text-text-muted">{s.index + 1}.</span>
                    {s.heading || "(no heading)"}
                  </summary>
                  <p className="mt-3 whitespace-pre-wrap text-[14px] leading-relaxed text-text [overflow-wrap:anywhere]">{s.content}</p>
                </details>
                <p className="mt-1 line-clamp-2 text-[13px] text-text-muted [details[open]~&]:hidden">{s.content}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

// "Delete 'pricing.md'?" (design: Admin — Delete document dialog).
export function DeleteDialog({ api, document: doc, onClose, onDeleted }: { api: string; document: DocumentRow; onClose: () => void; onDeleted: () => void }) {
  const panel = useDialog(onClose);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const remove = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${api}/documents/${doc.id}`, { method: "DELETE" });
      // 404: already gone (another tab); the list refresh shows that.
      if (!res.ok && res.status !== 404) throw new Error();
      onDeleted();
    } catch {
      setError("Couldn't delete the document. Please try again.");
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={busy ? undefined : onClose}>
      <div
        ref={panel}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-title"
        aria-describedby="delete-description"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-[440px] flex-col rounded-2xl border border-border bg-surface p-6 shadow-level-2 outline-none"
      >
        <span aria-hidden className="mb-4 flex size-10 items-center justify-center rounded-full bg-danger/10 text-danger">
          <Trash2 className="size-5" />
        </span>
        <h2 id="delete-title" className="text-[18px] font-semibold break-words">
          Delete “{doc.title}”?
        </h2>
        <p id="delete-description" className="mt-2 text-[14px] leading-relaxed text-text-muted">
          The assistant will stop using this information right away. This can&apos;t be undone.
        </p>
        {error && (
          <p role="alert" className="mt-3 text-[13px] text-danger">
            {error}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} disabled={busy} className="h-10 rounded-lg border border-border bg-surface px-4 text-[14px] font-medium hover:bg-surface-muted disabled:opacity-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-danger px-4 text-[14px] font-medium text-white hover:opacity-90 disabled:opacity-60 dark:text-bg"
          >
            {busy && <Loader2 aria-hidden className="size-4 animate-spin" />}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
