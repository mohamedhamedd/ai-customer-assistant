"use client";

import { Clock, Download, Loader2, Plus, Search, Tags, Trash2, Upload, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { emptyRow, parseServicesCsv, SERVICE_LIMITS, servicesToCsv, validateServices, type RowError, type ServiceField, type ServiceRow } from "@/lib/admin/service-rows";
import { AdminHeader } from "./header";
import { Badge, useDialog, useToast } from "./ui";

// Services: the business's services as cards, grouped by category. A card
// opens an editor; each change (add, edit, delete, CSV import) is saved at
// once, as the whole list (replace_services), so what's on screen is what
// the assistant uses.

const UNCATEGORISED = "Other services";

const input =
  "w-full min-w-0 rounded-lg border bg-surface px-3 text-[14px] text-text placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";
const tool =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-muted disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent";

type SaveResult = { ok: true } | { ok: false; error: string; rows: RowError[] };

// The editor: a new service (index null) or the one at `index`.
type Editing = { index: number | null; row: ServiceRow };

export function Services({ slug, initial }: { slug: string; initial: ServiceRow[] }) {
  const api = `/api/admin/${encodeURIComponent(slug)}/services`;
  const toast = useToast();
  const picker = useRef<HTMLInputElement>(null);
  const [services, setServices] = useState(initial);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [importing, setImporting] = useState<{ file: string; rows: ServiceRow[] } | null>(null);

  // Saves the whole list. Problems come back by row, in the list as sent.
  const save = async (next: ServiceRow[]): Promise<SaveResult> => {
    try {
      const res = await fetch(api, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ services: next }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json().catch(() => ({}))) as { services?: ServiceRow[]; error?: string; rows?: RowError[] };
      if (res.ok && Array.isArray(body.services)) {
        setServices(body.services);
        return { ok: true };
      }
      return { ok: false, error: body.error ?? "Couldn't save. Please try again.", rows: body.rows ?? [] };
    } catch {
      return { ok: false, error: "Couldn't save. Please try again.", rows: [] };
    }
  };

  const importFile = async (file: File) => {
    const parsed = parseServicesCsv(await file.text());
    if (!parsed.ok) return toast.show(parsed.error, "danger");
    setImporting({ file: file.name, rows: parsed.rows });
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([servicesToCsv(services)], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${slug}-services.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };

  // Categories in the order they first appear, each with its services (and
  // their place in the list, which is what the editor saves by).
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string, { row: ServiceRow; index: number }[]>();
    services.forEach((row, index) => {
      if (q && ![row.name, row.category, row.description].some((t) => t.toLowerCase().includes(q))) return;
      const key = row.category || UNCATEGORISED;
      map.set(key, [...(map.get(key) ?? []), { row, index }]);
    });
    return [...map.entries()];
  }, [services, query]);
  const categories = useMemo(() => [...new Set(services.map((s) => s.category).filter(Boolean))], [services]);
  const requestable = services.filter((s) => s.requestable).length;
  const shown = groups.reduce((n, [, items]) => n + items.length, 0);
  const add = (category = "") => setEditing({ index: null, row: { ...emptyRow(), category } });

  return (
    <>
      <AdminHeader title="Services" slug={slug}>
        <button
          type="button"
          onClick={() => add()}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-3.5 text-[14px] font-medium text-accent-contrast hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <Plus aria-hidden className="size-4" />
          <span className="hidden sm:inline">Add service</span>
        </button>
      </AdminHeader>

      <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-5">
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
            The services your business offers, as the assistant should name them. It answers names, prices and durations from here, and customers can request a
            consultation only for services marked <span className="font-medium text-text">Can request</span>.
          </p>

          {services.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1 basis-56">
                <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
                <label htmlFor="service-search" className="sr-only">
                  Search services
                </label>
                <input
                  id="service-search"
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search services"
                  className={`${input} h-9 border-border pl-8`}
                />
              </div>
              <button type="button" onClick={() => picker.current?.click()} className={tool}>
                <Upload aria-hidden className="size-3.5" />
                Import CSV
              </button>
              <button type="button" onClick={download} className={tool}>
                <Download aria-hidden className="size-3.5" />
                Download CSV
              </button>
            </div>
          )}

          {services.length === 0 ? (
            <section className="flex flex-col items-center justify-center rounded-2xl border border-border bg-surface p-12 text-center">
              <span aria-hidden className="mb-4 flex size-12 items-center justify-center rounded-full bg-surface-muted text-text-muted">
                <Tags className="size-6" />
              </span>
              <h2 className="max-w-md text-[16px] font-semibold leading-snug">List your services so the assistant names and prices them exactly</h2>
              <p className="mt-2 max-w-md text-[14px] text-text-muted">Add them one by one, or fill the CSV template in a spreadsheet and import it.</p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <button type="button" onClick={() => add()} className={`${tool} border-accent text-accent`}>
                  <Plus aria-hidden className="size-3.5" />
                  Add service
                </button>
                <button type="button" onClick={() => picker.current?.click()} className={tool}>
                  <Upload aria-hidden className="size-3.5" />
                  Import CSV
                </button>
                <button type="button" onClick={download} className={tool}>
                  <Download aria-hidden className="size-3.5" />
                  Download template
                </button>
              </div>
            </section>
          ) : (
            <>
              <p className="text-[13px] text-text-muted" aria-live="polite">
                {query ? `${shown} of ${services.length} services` : `${services.length} ${services.length === 1 ? "service" : "services"} · ${requestable} can be requested`}
              </p>
              {groups.length === 0 && <p className="rounded-2xl border border-border bg-surface p-8 text-center text-[14px] text-text-muted">No services match “{query.trim()}”.</p>}
              {groups.map(([category, items], g) => (
                <section key={category} aria-labelledby={`group-${g}`} className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <h2 id={`group-${g}`} className="text-[15px] font-semibold">
                      {category} <span className="font-normal text-text-muted">· {items.length}</span>
                    </h2>
                    <button
                      type="button"
                      onClick={() => add(category === UNCATEGORISED ? "" : category)}
                      aria-label={`Add a service to ${category}`}
                      className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] font-medium text-accent hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      <Plus aria-hidden className="size-3.5" />
                      Add
                    </button>
                  </div>
                  <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {items.map(({ row, index }) => (
                      <li key={`${index}-${row.name}`}>
                        <ServiceCard row={row} onOpen={() => setEditing({ index, row })} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </>
          )}
        </div>
      </main>

      {editing && (
        <ServiceEditor
          key={editing.index ?? "new"}
          editing={editing}
          services={services}
          categories={categories}
          save={save}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            toast.show(message);
          }}
        />
      )}
      {importing && (
        <ImportDialog
          file={importing.file}
          rows={importing.rows}
          current={services.length}
          save={save}
          onClose={() => setImporting(null)}
          onSaved={(n) => {
            setImporting(null);
            toast.show(`${n} ${n === 1 ? "service" : "services"} imported`);
          }}
        />
      )}
      {toast.element}
    </>
  );
}

function ServiceCard({ row, onOpen }: { row: ServiceRow; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Edit ${row.name}`}
      className="flex h-full w-full flex-col gap-2 rounded-2xl border border-border bg-surface p-4 text-left transition-colors hover:border-accent/60 hover:bg-surface-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span className="line-clamp-2 text-[14px] font-medium leading-snug">{row.name}</span>
      {row.price ? <span className="text-[18px] font-semibold leading-tight">{row.price}</span> : <span className="text-[14px] text-text-muted">No price</span>}
      {row.duration && (
        <span className="flex items-center gap-1.5 text-[13px] text-text-muted">
          <Clock aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">{row.duration}</span>
        </span>
      )}
      {row.description && <span className="line-clamp-2 text-[13px] text-text-muted">{row.description}</span>}
      <span className="mt-auto pt-1">{row.requestable ? <Badge tone="success">Can request</Badge> : <Badge tone="neutral">Not requestable</Badge>}</span>
    </button>
  );
}

const FIELDS: { field: Exclude<ServiceField, "requestable" | "description">; label: string; placeholder: string; max: number }[] = [
  { field: "name", label: "Service", placeholder: "e.g. Personal training session", max: SERVICE_LIMITS.name },
  { field: "category", label: "Category", placeholder: "e.g. Training", max: SERVICE_LIMITS.category },
  { field: "price", label: "Price", placeholder: "e.g. $60, $40 to $80, Free", max: SERVICE_LIMITS.price },
  { field: "duration", label: "Duration", placeholder: "e.g. 60 minutes", max: SERVICE_LIMITS.duration },
];

function ServiceEditor({
  editing,
  services,
  categories,
  save,
  onClose,
  onSaved,
}: {
  editing: Editing;
  services: ServiceRow[];
  categories: string[];
  save: (next: ServiceRow[]) => Promise<SaveResult>;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [row, setRow] = useState(editing.row);
  const [errors, setErrors] = useState<Partial<Record<ServiceField, string>>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const panel = useDialog(onClose, { busy });
  const isNew = editing.index === null;
  // Where this service sits in the list that's saved.
  const at = editing.index ?? services.length;

  const change = (field: ServiceField, value: string | boolean) => {
    setRow((r) => ({ ...r, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
  };
  // The problems with this service, by field. A repeated name says which
  // service has it, not a row number (there are no rows here).
  const mine = (rows: RowError[]) =>
    Object.fromEntries(
      rows
        .filter((r) => r.row === at)
        .map((r) => {
          const same = services.find((s, i) => i !== editing.index && s.name.trim().toLowerCase() === row.name.trim().toLowerCase());
          return [r.field, r.field === "name" && same ? `${same.name} is already listed.` : r.message];
        }),
    );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    // A row with no name counts as blank in the list (and is dropped); here it's a mistake.
    if (!row.name.trim()) {
      setErrors({ name: "Enter the service's name." });
      return document.getElementById("service-name")?.focus();
    }
    const next = isNew ? [...services, row] : services.map((s, i) => (i === editing.index ? row : s));
    // Same rules as the server first: most mistakes are caught without a round trip.
    const local = validateServices(next);
    if (!local.ok) {
      const own = mine(local.errors);
      setErrors(own);
      setError(Object.keys(own).length ? "" : local.error);
      document.getElementById(`service-${Object.keys(own)[0] ?? "name"}`)?.focus();
      return;
    }
    setBusy(true);
    const result = await save(next);
    setBusy(false);
    if (result.ok) return onSaved(isNew ? `${row.name.trim()} added` : "Service saved");
    setErrors(mine(result.rows));
    setError(result.error);
  };

  const remove = async () => {
    setBusy(true);
    const result = await save(services.filter((_, i) => i !== editing.index));
    setBusy(false);
    if (result.ok) return onSaved(`${editing.row.name} deleted`);
    setConfirmDelete(false);
    setError(result.error);
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={busy ? undefined : onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="service-editor-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-[460px] flex-col border-l border-border bg-surface shadow-level-2 outline-none"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border p-5">
          <h2 id="service-editor-title" className="min-w-0 text-[18px] font-semibold break-words">
            {isNew ? "Add a service" : editing.row.name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-surface-muted hover:text-text disabled:opacity-50"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>

        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5">
            {FIELDS.map((f) => {
              const id = `service-${f.field}`;
              const message = errors[f.field];
              return (
                <div key={f.field} className="flex flex-col gap-1.5">
                  <label htmlFor={id} className="text-[13px] font-medium">
                    {f.label}
                    {f.field === "name" && <span className="text-danger"> *</span>}
                  </label>
                  <input
                    id={id}
                    value={row[f.field]}
                    maxLength={f.max}
                    placeholder={f.placeholder}
                    list={f.field === "category" ? "service-categories" : undefined}
                    onChange={(e) => change(f.field, e.target.value)}
                    aria-invalid={!!message}
                    aria-describedby={message ? `${id}-error` : undefined}
                    className={`${input} h-10 ${message ? "border-danger" : "border-border"}`}
                  />
                  {message && (
                    <p id={`${id}-error`} className="text-[12px] text-danger">
                      {message}
                    </p>
                  )}
                </div>
              );
            })}
            <datalist id="service-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="service-description" className="text-[13px] font-medium">
                Description
              </label>
              <textarea
                id="service-description"
                value={row.description}
                maxLength={SERVICE_LIMITS.description}
                rows={3}
                placeholder="Optional, one or two lines"
                onChange={(e) => change("description", e.target.value)}
                aria-invalid={!!errors.description}
                aria-describedby={errors.description ? "service-description-error" : undefined}
                className={`${input} py-2 ${errors.description ? "border-danger" : "border-border"}`}
              />
              {errors.description && (
                <p id="service-description-error" className="text-[12px] text-danger">
                  {errors.description}
                </p>
              )}
            </div>

            <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-border p-3">
              <span className="flex flex-col gap-0.5">
                <span className="text-[14px] font-medium">Customers can request it</span>
                <span className="text-[12px] text-text-muted">The assistant can send a consultation request for this service.</span>
              </span>
              <input type="checkbox" role="switch" checked={row.requestable} onChange={(e) => change("requestable", e.target.checked)} className="peer sr-only" />
              <span
                aria-hidden
                className="relative mt-0.5 h-6 w-11 shrink-0 rounded-full bg-border transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:bg-accent peer-checked:after:translate-x-5 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
              />
            </label>

            {error && (
              <p role="alert" className="text-[13px] text-danger">
                {error}
              </p>
            )}
          </div>

          <div className="flex items-center gap-3 border-t border-border p-4">
            {isNew ? (
              <span className="mr-auto" />
            ) : confirmDelete ? (
              <span className="mr-auto flex items-center gap-2">
                <span className="text-[13px]">Delete it?</span>
                <button
                  type="button"
                  onClick={remove}
                  disabled={busy}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-danger px-3 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-60 dark:text-bg"
                >
                  {busy && <Loader2 aria-hidden className="size-3.5 animate-spin" />}
                  Delete
                </button>
                <button type="button" onClick={() => setConfirmDelete(false)} disabled={busy} className="h-9 rounded-lg px-2 text-[13px] text-text-muted hover:text-text">
                  Keep
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
                className="mr-auto inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
              >
                <Trash2 aria-hidden className="size-3.5" />
                Delete
              </button>
            )}
            <button type="button" onClick={onClose} disabled={busy} className="h-10 rounded-lg border border-border bg-surface px-4 text-[14px] font-medium hover:bg-surface-muted disabled:opacity-50">
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || confirmDelete}
              aria-busy={busy && !confirmDelete}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-accent px-4 text-[14px] font-medium text-accent-contrast hover:opacity-90 disabled:opacity-50"
            >
              {busy && !confirmDelete && <Loader2 aria-hidden className="size-4 animate-spin" />}
              {isNew ? "Add service" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// A CSV import replaces the whole list, so it asks first, and shows the
// file's problems (by its own row numbers) before anything is sent.
function ImportDialog({
  file,
  rows,
  current,
  save,
  onClose,
  onSaved,
}: {
  file: string;
  rows: ServiceRow[];
  current: number;
  save: (next: ServiceRow[]) => Promise<SaveResult>;
  onClose: () => void;
  onSaved: (n: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const panel = useDialog(onClose, { busy });
  const valid = validateServices(rows);
  // In the file's own row numbers: its row 1 is the header.
  const fileRow = (listRow: number) => listRow + 2;
  const problems = valid.ok
    ? []
    : valid.errors.slice(0, 5).map((e) => `Row ${fileRow(e.row)}: ${e.message.replace(/row (\d+)/, (_, n: string) => `row ${fileRow(Number(n) - 1)}`)}`);
  const count = valid.ok ? valid.rows.length : rows.length;

  const confirm = async () => {
    setBusy(true);
    const result = await save(rows);
    setBusy(false);
    if (result.ok) return onSaved(count);
    setError(result.error);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={busy ? undefined : onClose}>
      <div
        ref={panel}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="import-title"
        aria-describedby="import-description"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-[460px] flex-col rounded-2xl border border-border bg-surface p-6 shadow-level-2 outline-none"
      >
        <span aria-hidden className="mb-4 flex size-10 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Upload className="size-5" />
        </span>
        <h2 id="import-title" className="text-[18px] font-semibold break-words">
          Import {count} {count === 1 ? "service" : "services"} from {file}?
        </h2>
        <p id="import-description" className="mt-2 text-[14px] leading-relaxed text-text-muted">
          {current > 0 ? `This replaces your ${current} current ${current === 1 ? "service" : "services"}. ` : ""}The assistant uses the new list right away.
        </p>
        {problems.length > 0 && (
          <div role="alert" className="mt-3 rounded-lg bg-danger/10 p-3 text-[13px] text-danger">
            <p className="font-medium">Fix these in the file first:</p>
            <ul className="mt-1 list-disc pl-5">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}
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
            onClick={confirm}
            disabled={busy || problems.length > 0}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-[14px] font-medium text-accent-contrast hover:opacity-90 disabled:opacity-50"
          >
            {busy && <Loader2 aria-hidden className="size-4 animate-spin" />}
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
