"use client";

import { Check, FileText, Loader2, Search, Trash2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// Type-only: erased at build, so no server code reaches the browser.
import type { DocumentRow } from "@/lib/admin/knowledge";
import { ACCEPTED_EXTENSIONS, checkUpload } from "@/lib/rag/file-types";
import { DeleteDialog, DocumentDrawer } from "./document-panels";
import { AdminHeader } from "./header";
import { TestSearch } from "./test-search";
import { Badge } from "./ui";

// The knowledge base (US-7.1 – 7.5): upload, see, preview and delete the
// documents the assistant answers from. Built from the Stitch admin screens.


type UploadState =
  | { kind: "waiting" }
  | { kind: "uploading"; percent: number }
  | { kind: "processing" }
  | { kind: "ready"; sections: number }
  | { kind: "duplicate" }
  // Another document has this title: the admin can replace it.
  | { kind: "title_taken"; existingDocumentId: string; message: string }
  | { kind: "failed"; message: string };

interface UploadItem {
  key: string;
  file: File;
  state: UploadState;
}

type IngestResult =
  | { status: "ready"; chunkCount: number }
  | { status: "duplicate" }
  | { status: "title_taken"; existingDocumentId: string; error: string }
  | { status: "failed"; error: string };

// fetch() can't report upload progress; XMLHttpRequest can. Once the bytes
// are sent the server is extracting, chunking and embedding ("Processing").
function sendFile(
  url: string,
  file: File,
  replaces: string | undefined,
  onProgress: (percent: number) => void,
  onSent: () => void,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.upload.onload = onSent;
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => reject(new Error("network"));
    const form = new FormData();
    form.append("file", file);
    if (replaces) form.append("replaces", replaces);
    xhr.send(form);
  });
}

export function KnowledgeBase({ slug }: { slug: string }) {
  const api = `/api/admin/${encodeURIComponent(slug)}`;
  const [documents, setDocuments] = useState<DocumentRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [filter, setFilter] = useState("");
  const [viewing, setViewing] = useState<DocumentRow | null>(null);
  const [deleting, setDeleting] = useState<DocumentRow | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${api}/documents`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      setDocuments(((await res.json()) as { documents: DocumentRow[] }).documents);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [api]);

  useEffect(() => {
    // Fetching on mount; the state is set when the response arrives.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const update = (key: string, state: UploadState) => setUploads((us) => us.map((u) => (u.key === key ? { ...u, state } : u)));

  // One file at a time: each one is a few seconds of embedding, and the
  // order on screen is the order they finish.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const enqueue = (item: UploadItem, replaces?: string) => {
    queue.current = queue.current.then(async () => {
      update(item.key, { kind: "uploading", percent: 0 });
      try {
        const { status, body } = await sendFile(
          `${api}/documents`,
          item.file,
          replaces,
          (percent) => update(item.key, { kind: "uploading", percent }),
          () => update(item.key, { kind: "processing" }),
        );
        const result = body as IngestResult & { error?: string };
        if (status !== 200) update(item.key, { kind: "failed", message: result?.error ?? "The upload failed." });
        else if (result.status === "ready") update(item.key, { kind: "ready", sections: result.chunkCount });
        else if (result.status === "duplicate") update(item.key, { kind: "duplicate" });
        else if (result.status === "title_taken") update(item.key, { kind: "title_taken", existingDocumentId: result.existingDocumentId, message: result.error });
        else update(item.key, { kind: "failed", message: result.error });
      } catch {
        update(item.key, { kind: "failed", message: "Couldn't reach the server. Check your connection and try again." });
      }
      await refresh();
    });
  };
  const add = (files: FileList | File[]) => {
    const items: UploadItem[] = [...files].map((file) => {
      const problem = checkUpload(file.name, file.size);
      return { key: `${file.name}-${Math.random().toString(36).slice(2)}`, file, state: problem ? { kind: "failed", message: problem } : { kind: "waiting" } };
    });
    setUploads((us) => [...items, ...us]);
    for (const item of items) if (item.state.kind === "waiting") enqueue(item); // the rest were refused before upload
  };
  // The new file takes the old one's place in one step (its chunks swap
  // atomically), so the assistant never sees both or neither.
  const replace = (item: UploadItem, existingDocumentId: string) => {
    update(item.key, { kind: "waiting" });
    enqueue(item, existingDocumentId);
  };

  const [dragging, setDragging] = useState(false);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (documents ?? []).filter((d) => !q || d.title.toLowerCase().includes(q));
  }, [documents, filter]);
  const empty = documents !== null && documents.length === 0 && uploads.length === 0;
  const inQueue = uploads.filter((u) => u.state.kind === "waiting" || u.state.kind === "uploading" || u.state.kind === "processing").length;

  return (
    <>
      <AdminHeader title="Knowledge base" slug={slug}>
        <button
          type="button"
          onClick={() => picker.current?.click()}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-3.5 text-[14px] font-medium text-accent-contrast hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <Upload aria-hidden className="size-4" />
          <span className="hidden sm:inline">Upload documents</span>
        </button>
      </AdminHeader>

      <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-6">
          <input
            ref={picker}
            type="file"
            multiple
            accept={ACCEPTED_EXTENSIONS}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              if (e.target.files?.length) add(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => picker.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (e.dataTransfer.files.length) add(e.dataTransfer.files);
            }}
            className={`flex h-[120px] w-full flex-col items-center justify-center rounded-2xl border border-dashed bg-surface transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              dragging ? "border-accent bg-accent/5" : "border-border hover:border-accent/60"
            }`}
          >
            <span aria-hidden className="mb-2 flex size-9 items-center justify-center rounded-full bg-surface-muted text-text-muted">
              <Upload className="size-5" />
            </span>
            <span className="text-[14px]">
              Drag files here or <span className="font-medium text-accent underline underline-offset-2">browse</span>
            </span>
            <span className="mt-1 text-[12px] text-text-muted">txt, md or text-based PDF · up to 10 MB</span>
          </button>

          {uploads.length > 0 && (
            <section aria-label="Uploads" className="rounded-2xl border border-border bg-surface p-5">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <h2 className="text-[14px] font-semibold">Uploads</h2>
                <span className="text-[12px] text-text-muted">{inQueue > 0 ? `${inQueue} in queue` : "Done"}</span>
              </div>
              <ul className="divide-y divide-border" aria-live="polite">
                {uploads.map((u) => (
                  <UploadRow
                    key={u.key}
                    item={u}
                    onReplace={(id) => replace(u, id)}
                    onDismiss={() => setUploads((us) => us.filter((x) => x.key !== u.key))}
                  />
                ))}
              </ul>
            </section>
          )}

          {documents !== null && documents.some((d) => d.status === "ready") && <TestSearch api={api} />}

          {empty ? (
            <EmptyState />
          ) : (
            <section aria-label="Documents" className="overflow-hidden rounded-2xl border border-border bg-surface">
              <div className="flex flex-col justify-between gap-3 border-b border-border p-5 sm:flex-row sm:items-center">
                <div className="flex items-center gap-2">
                  <h2 id="documents-heading" tabIndex={-1} className="text-[14px] font-semibold outline-none">
                    Documents
                  </h2>
                  {documents && <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[12px] font-medium text-text-muted">{documents.length}</span>}
                </div>
                <label className="relative w-full sm:w-64">
                  <span className="sr-only">Search documents</span>
                  <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
                  <input
                    type="search"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Search documents"
                    className="h-9 w-full rounded-lg border border-border bg-surface pl-8 pr-3 text-[14px] placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </label>
              </div>
              {documents === null ? (
                <p className="flex items-center gap-2 p-5 text-[14px] text-text-muted">
                  {loadError ? (
                    <>
                      Couldn&apos;t load the documents.{" "}
                      <button type="button" onClick={refresh} className="underline">
                        Try again
                      </button>
                    </>
                  ) : (
                    <>
                      <Loader2 aria-hidden className="size-4 animate-spin" /> Loading documents…
                    </>
                  )}
                </p>
              ) : (
                <DocumentsTable documents={shown} onView={setViewing} onDelete={setDeleting} />
              )}
            </section>
          )}
        </div>
      </main>

      {viewing && <DocumentDrawer api={api} document={viewing} onClose={() => setViewing(null)} />}
      {deleting && (
        <DeleteDialog
          api={api}
          document={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            void refresh();
          }}
        />
      )}
    </>
  );
}

function UploadRow({ item, onReplace, onDismiss }: { item: UploadItem; onReplace: (existingDocumentId: string) => void; onDismiss: () => void }) {
  const { file, state } = item;
  const finished = state.kind === "ready" || state.kind === "duplicate" || state.kind === "failed" || state.kind === "title_taken";
  return (
    <li className="flex flex-col gap-2 py-3 text-[14px] sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <FileText aria-hidden className="size-5 shrink-0 text-text-muted" />
        <span className="truncate font-medium">{file.name}</span>
        <span className="shrink-0 text-[12px] text-text-muted">{formatSize(file.size)}</span>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {(state.kind === "failed" || state.kind === "title_taken") && <span className="max-w-sm text-[12px] text-text-muted">{state.message}</span>}
        {state.kind === "title_taken" && (
          <button
            type="button"
            onClick={() => onReplace(state.existingDocumentId)}
            className="inline-flex h-8 shrink-0 items-center rounded-lg border border-border px-3 text-[12px] font-medium hover:bg-surface-muted"
          >
            Replace
          </button>
        )}
        {state.kind === "waiting" && <span className="text-[12px] text-text-muted">Waiting…</span>}
        {state.kind === "uploading" && (
          <>
            <span className="h-1.5 w-36 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
              <span className="block h-full rounded-full bg-accent" style={{ width: `${state.percent}%` }} />
            </span>
            <span className="w-24 text-right text-[12px] font-medium text-text-muted">Uploading… {state.percent}%</span>
          </>
        )}
        {state.kind === "processing" && (
          <Badge tone="info">
            <Loader2 aria-hidden className="size-3.5 animate-spin" /> Processing
          </Badge>
        )}
        {state.kind === "ready" && (
          <Badge tone="success">
            <Check aria-hidden className="size-3.5" /> Ready · {state.sections} {state.sections === 1 ? "section" : "sections"}
          </Badge>
        )}
        {state.kind === "duplicate" && <Badge tone="neutral">Already in your knowledge base</Badge>}
        {state.kind === "failed" && <Badge tone="danger">Failed</Badge>}
        {finished && (
          <button type="button" onClick={onDismiss} aria-label={`Dismiss ${file.name}`} className="inline-flex size-8 items-center justify-center rounded text-text-muted hover:bg-surface-muted hover:text-text">
            <X aria-hidden className="size-4" />
          </button>
        )}
      </div>
    </li>
  );
}

function DocumentsTable({ documents, onView, onDelete }: { documents: DocumentRow[]; onView: (d: DocumentRow) => void; onDelete: (d: DocumentRow) => void }) {
  if (documents.length === 0) return <p className="p-5 text-[14px] text-text-muted">No documents match.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-border bg-surface-muted text-[13px]">
            <th className="px-5 py-2.5 font-medium">Title</th>
            <th className="w-24 px-4 py-2.5 font-medium">Type</th>
            <th className="w-32 px-4 py-2.5 font-medium">Status</th>
            <th className="w-24 px-4 py-2.5 font-medium">Sections</th>
            <th className="w-32 px-4 py-2.5 font-medium">Uploaded</th>
            <th className="w-32 px-5 py-2.5">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border text-[14px]">
          {documents.map((d) => (
            <tr key={d.id} className="hover:bg-surface-muted/50">
              <td className="px-5 py-3 font-medium">
                <div className="flex items-center gap-2.5">
                  <FileText aria-hidden className="size-4 shrink-0 text-text-muted" />
                  <span className="break-words">{d.title}</span>
                </div>
                {d.status === "failed" && d.error && <p className="mt-1 pl-6.5 text-[12px] font-normal text-danger">{d.error}</p>}
              </td>
              <td className="px-4 py-3">
                <span className="rounded border border-border bg-surface px-2 py-0.5 text-[12px] font-medium uppercase text-text-muted">{d.sourceType}</span>
              </td>
              <td className="px-4 py-3">
                {d.status === "ready" && <Badge tone="success">Ready</Badge>}
                {d.status === "failed" && <Badge tone="danger">Failed</Badge>}
                {d.status === "processing" && (
                  <Badge tone="info">
                    <Loader2 aria-hidden className="size-3.5 animate-spin" /> Processing
                  </Badge>
                )}
              </td>
              <td className="px-4 py-3 text-text-muted">{d.status === "ready" ? d.sections : "–"}</td>
              <td className="px-4 py-3 text-text-muted">
                <time dateTime={d.uploadedAt} title={new Date(d.uploadedAt).toLocaleString()}>
                  {new Date(d.uploadedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </time>
              </td>
              <td className="px-5 py-3 text-right">
                <div className="flex items-center justify-end gap-1">
                  {d.status === "ready" && (
                    <button type="button" onClick={() => onView(d)} className="min-h-8 rounded px-2 text-[12px] font-medium hover:bg-surface-muted">
                      View<span className="sr-only"> {d.title}</span>
                    </button>
                  )}
                  {/* Not while it's being processed: the upload would fail half-way. */}
                  {d.status !== "processing" && (
                    <button
                      type="button"
                      onClick={() => onDelete(d)}
                      aria-label={`Delete ${d.title}`}
                      className="inline-flex size-8 items-center justify-center rounded text-text-muted hover:bg-danger/10 hover:text-danger"
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState() {
  return (
    <section className="flex flex-col items-center justify-center rounded-2xl border border-border bg-surface p-12 text-center">
      <span aria-hidden className="mb-4 flex size-12 items-center justify-center rounded-full bg-surface-muted text-text-muted">
        <FileText className="size-6" />
      </span>
      <h2 className="max-w-md text-[16px] font-semibold leading-snug">Upload your first document so the assistant can learn about your business</h2>
      <p className="mt-5 text-[14px] text-text-muted">Good first documents:</p>
      <ul className="mt-3 flex flex-wrap justify-center gap-2">
        {["Price list", "FAQ", "Opening hours"].map((s) => (
          <li key={s} className="rounded-full border border-border px-3 py-1 text-[12px] text-text-muted">
            {s}
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
