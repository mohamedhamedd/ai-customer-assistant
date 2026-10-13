"use client";

import { Download, Loader2, Plus, Sparkles, Tags, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { emptyRow, parseServicesCsv, SERVICE_LIMITS, servicesToCsv, type RowError, type ServiceField, type ServiceRow } from "@/lib/admin/service-rows";
import { AdminHeader } from "./header";
import { useToast } from "./ui";

// Services: the business's services as a table (name, category, price,
// duration, description, whether customers can request it). Edited here,
// imported from the CSV template, or filled from the business's documents;
// saved at once.

const input =
  "w-full min-w-0 rounded-lg border bg-surface px-2.5 text-[14px] text-text placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

const COLUMNS: { field: Exclude<ServiceField, "requestable">; label: string; placeholder: string; max: number }[] = [
  { field: "name", label: "Service", placeholder: "e.g. Personal training session", max: SERVICE_LIMITS.name },
  { field: "category", label: "Category", placeholder: "e.g. Training", max: SERVICE_LIMITS.category },
  { field: "price", label: "Price", placeholder: "e.g. $60, Free", max: SERVICE_LIMITS.price },
  { field: "duration", label: "Duration", placeholder: "e.g. 60 minutes", max: SERVICE_LIMITS.duration },
  { field: "description", label: "Description", placeholder: "Optional, one line", max: SERVICE_LIMITS.description },
];

// Rows with a key for React, so editing one doesn't remount the others.
type Keyed = ServiceRow & { key: number };
let nextKey = 0;
const keyed = (rows: ServiceRow[]): Keyed[] => rows.map((r) => ({ ...r, key: nextKey++ }));
const plain = (rows: Keyed[]): ServiceRow[] =>
  rows.map((r) => ({ name: r.name, category: r.category, price: r.price, duration: r.duration, description: r.description, requestable: r.requestable }));

export function Services({ slug, initial }: { slug: string; initial: ServiceRow[] }) {
  const api = `/api/admin/${encodeURIComponent(slug)}/services`;
  const toast = useToast();
  const picker = useRef<HTMLInputElement>(null);
  const [saved, setSaved] = useState(initial);
  const [rows, setRows] = useState(() => keyed(initial));
  const [errors, setErrors] = useState<RowError[]>([]);
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const dirty = JSON.stringify(plain(rows)) !== JSON.stringify(saved);
  const errorAt = (row: number, field: ServiceField) => errors.find((e) => e.row === row && e.field === field)?.message;

  const replaceAll = (next: ServiceRow[], message: string) => {
    setRows(keyed(next));
    setErrors([]);
    setNote(message);
  };
  const update = (index: number, field: ServiceField, value: string | boolean) => {
    setRows((rs) => rs.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
    setErrors((es) => es.filter((e) => !(e.row === index && e.field === field)));
  };
  const remove = (index: number) => {
    setRows((rs) => rs.filter((_, i) => i !== index));
    // Rows below move up a place, and so do their errors.
    setErrors((es) => es.filter((e) => e.row !== index).map((e) => (e.row > index ? { ...e, row: e.row - 1 } : e)));
  };
  const add = () => {
    setRows((rs) => [...rs, ...keyed([emptyRow()])]);
    // Focus the new row's name once it's rendered.
    setTimeout(() => document.getElementById(`service-${rows.length}-name`)?.focus(), 0);
  };

  const fill = async () => {
    if (suggesting) return;
    setSuggesting(true);
    setNote(null);
    try {
      const res = await fetch(`${api}/suggest`, { method: "POST", signal: AbortSignal.timeout(100_000) });
      const body = (await res.json().catch(() => ({}))) as { services?: ServiceRow[]; error?: string };
      if (!res.ok || !Array.isArray(body.services)) return toast.show(body.error ?? "Couldn't read your documents just now. Try again.", "danger");
      if (body.services.length === 0) return toast.show("No services found in your documents. Add them here or import the template.", "danger");
      replaceAll(body.services, `${body.services.length} services found in your documents. Check them (prices and names are copied as written), then save.`);
    } catch {
      toast.show("Couldn't read your documents just now. Try again.", "danger");
    } finally {
      setSuggesting(false);
    }
  };

  const importFile = async (file: File) => {
    const parsed = parseServicesCsv(await file.text());
    if (!parsed.ok) return toast.show(parsed.error, "danger");
    replaceAll(parsed.rows, `${parsed.rows.length} services imported from ${file.name}. Check them, then save.`);
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([servicesToCsv(plain(rows))], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${slug}-services.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch(api, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ services: plain(rows) }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json().catch(() => ({}))) as { services?: ServiceRow[]; error?: string; rows?: RowError[] };
      if (res.ok && Array.isArray(body.services)) {
        setSaved(body.services);
        setRows(keyed(body.services));
        setErrors([]);
        setNote(null);
        return toast.show("Services saved");
      }
      setErrors(body.rows ?? []);
      const first = body.rows?.[0];
      if (first) document.getElementById(`service-${first.row}-${first.field}`)?.focus();
      toast.show(body.error ?? "Couldn't save. Please try again.", "danger");
    } catch {
      toast.show("Couldn't save. Please try again.", "danger");
    } finally {
      setSaving(false);
    }
  };

  const tool = "inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] font-medium hover:bg-surface-muted disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent";

  return (
    <>
      <AdminHeader title="Services" slug={slug}>
        <button
          type="button"
          onClick={add}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-3.5 text-[14px] font-medium text-accent-contrast hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <Plus aria-hidden className="size-4" />
          <span className="hidden sm:inline">Add service</span>
        </button>
      </AdminHeader>

      <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-4">
          <input
            ref={picker}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importFile(file);
              e.target.value = "";
            }}
          />
          <p className="max-w-3xl text-[14px] text-text-muted">
            The services your business offers, as the assistant should name them. Customers can request a consultation only for services marked{" "}
            <span className="font-medium text-text">Can request</span>, under the name written here.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={fill} disabled={suggesting} aria-busy={suggesting} className={tool}>
              {suggesting ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <Sparkles aria-hidden className="size-3.5" />}
              {suggesting ? "Reading your documents…" : "Fill from documents"}
            </button>
            <button type="button" onClick={() => picker.current?.click()} className={tool}>
              <Upload aria-hidden className="size-3.5" />
              Import CSV
            </button>
            <button type="button" onClick={download} className={tool}>
              <Download aria-hidden className="size-3.5" />
              {rows.length ? "Download CSV" : "Download template"}
            </button>
          </div>
          {note && (
            <p role="status" className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-[13px]">
              {note}
            </p>
          )}

          {rows.length === 0 ? (
            <section className="flex flex-col items-center justify-center rounded-2xl border border-border bg-surface p-12 text-center">
              <span aria-hidden className="mb-4 flex size-12 items-center justify-center rounded-full bg-surface-muted text-text-muted">
                <Tags className="size-6" />
              </span>
              <h2 className="max-w-md text-[16px] font-semibold leading-snug">List your services so the assistant names them exactly</h2>
              <p className="mt-2 max-w-md text-[14px] text-text-muted">
                Fill them from the documents you uploaded, import the CSV template from a spreadsheet, or add them one by one.
              </p>
            </section>
          ) : (
            <div className="rounded-2xl border border-border bg-surface">
              <div
                aria-hidden
                className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)_88px_40px] gap-2 border-b border-border bg-surface-muted px-4 py-2.5 text-[12px] font-medium text-text-muted md:grid"
              >
                {COLUMNS.map((c) => (
                  <span key={c.field}>{c.label}</span>
                ))}
                <span>Can request</span>
                <span />
              </div>
              <ul className="divide-y divide-border">
                {rows.map((r, i) => (
                  <li
                    key={r.key}
                    className="grid grid-cols-1 gap-2 p-4 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)_88px_40px] md:items-start md:px-4 md:py-2"
                  >
                    {COLUMNS.map((c) => {
                      const id = `service-${i}-${c.field}`;
                      const error = errorAt(i, c.field);
                      return (
                        <div key={c.field} className="min-w-0">
                          <label htmlFor={id} className="mb-1 block text-[12px] font-medium text-text-muted md:sr-only">
                            {c.label}
                          </label>
                          <input
                            id={id}
                            value={r[c.field]}
                            title={r[c.field] || undefined}
                            maxLength={c.max}
                            placeholder={c.placeholder}
                            onChange={(e) => update(i, c.field, e.target.value)}
                            aria-invalid={!!error}
                            aria-describedby={error ? `${id}-error` : undefined}
                            className={`${input} h-9 ${error ? "border-danger" : "border-border"}`}
                          />
                          {error && (
                            <p id={`${id}-error`} className="mt-1 text-[12px] text-danger">
                              {error}
                            </p>
                          )}
                        </div>
                      );
                    })}
                    <label className="flex h-9 items-center gap-2 text-[13px]">
                      <input type="checkbox" checked={r.requestable} onChange={(e) => update(i, "requestable", e.target.checked)} className="size-4 accent-[var(--color-accent)]" />
                      <span className="md:sr-only">Customers can request it</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => remove(i)}
                      aria-label={`Remove ${r.name || "this service"}`}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-text-muted hover:bg-surface-muted hover:text-danger focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Down to the window's edge: past main's own padding, so rows don't show below it. */}
          <div className="sticky -bottom-4 -mx-4 -mb-4 flex items-center justify-end gap-3 border-t border-border bg-bg px-4 py-3 md:-bottom-8 md:-mx-8 md:-mb-8 md:px-8">
            <span className="mr-auto text-[13px] text-text-muted">
              {rows.length} {rows.length === 1 ? "service" : "services"}
              {dirty && " · unsaved changes"}
            </span>
            <button
              type="button"
              disabled={!dirty || saving}
              onClick={() => {
                setRows(keyed(saved));
                setErrors([]);
                setNote(null);
              }}
              className="h-10 whitespace-nowrap rounded-lg px-3 text-[14px] font-medium text-text-muted hover:text-text disabled:opacity-50 sm:px-4"
            >
              Discard<span className="hidden sm:inline"> changes</span>
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!dirty || saving}
              aria-busy={saving}
              className="inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-lg bg-accent px-4 text-[14px] font-medium text-accent-contrast hover:opacity-90 disabled:opacity-50"
            >
              {saving && <Loader2 aria-hidden className="size-4 animate-spin" />}
              Save<span className="hidden sm:inline"> changes</span>
            </button>
          </div>
        </div>
      </main>
      {toast.element}
    </>
  );
}
