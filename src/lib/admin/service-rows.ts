import { z } from "zod";

// A business's services as rows (the services table): the rules shared by
// the admin page (editing, CSV import and export) and the server
// (validation). The database enforces the same limits. No server imports.

export interface ServiceRow {
  name: string;
  category: string;
  price: string;
  duration: string;
  description: string;
  // Customers can request a consultation for it.
  requestable: boolean;
}

export const SERVICE_LIMITS = { rows: 200, name: 120, category: 60, price: 60, duration: 60, description: 500 } as const;

export const emptyRow = (): ServiceRow => ({ name: "", category: "", price: "", duration: "", description: "", requestable: true });

const text = (max: number, label: string) => z.string().trim().max(max, `Keep the ${label} under ${max} characters.`);

const rowSchema = z.object({
  name: z.string().trim().min(1, "Enter the service's name.").max(SERVICE_LIMITS.name, `Keep the name under ${SERVICE_LIMITS.name} characters.`),
  category: text(SERVICE_LIMITS.category, "category"),
  price: text(SERVICE_LIMITS.price, "price"),
  duration: text(SERVICE_LIMITS.duration, "duration"),
  description: text(SERVICE_LIMITS.description, "description"),
  requestable: z.boolean(),
});

export type ServiceField = keyof ServiceRow;
export interface RowError {
  row: number;
  field: ServiceField;
  message: string;
}

const nameKey = (name: string) => name.trim().toLowerCase();

// The whole list: each row valid, names unique (ignoring case), at most
// SERVICE_LIMITS.rows. Blank rows (a row added and left empty) are dropped.
// The first problem with each field, by row index in the given list.
export function validateServices(input: unknown): { ok: true; rows: ServiceRow[] } | { ok: false; error: string; errors: RowError[] } {
  if (!Array.isArray(input)) return { ok: false, error: "Send the services as a list.", errors: [] };
  const isBlank = (r: unknown) => !!r && typeof r === "object" && Object.entries(r).every(([k, v]) => k === "requestable" || String(v ?? "").trim() === "");
  const kept = input.map((r, i) => ({ r, i })).filter(({ r }) => !isBlank(r));
  if (kept.length > SERVICE_LIMITS.rows) return { ok: false, error: `List at most ${SERVICE_LIMITS.rows} services.`, errors: [] };

  const rows: ServiceRow[] = [];
  const errors: RowError[] = [];
  const seen = new Map<string, number>();
  for (const { r, i } of kept) {
    const parsed = rowSchema.safeParse(r);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as ServiceField;
        if (!errors.some((e) => e.row === i && e.field === field)) errors.push({ row: i, field, message: issue.message });
      }
      continue;
    }
    const key = nameKey(parsed.data.name);
    if (seen.has(key)) {
      errors.push({ row: i, field: "name", message: `Already listed in row ${seen.get(key)! + 1}.` });
      continue;
    }
    seen.set(key, i);
    rows.push(parsed.data);
  }
  return errors.length ? { ok: false, error: "Some rows need fixing.", errors } : { ok: true, rows };
}

// ---------------------------------------------------------------------------
// The CSV template: what staff fill in a spreadsheet and import.
// ---------------------------------------------------------------------------

export const CSV_HEADERS = ["Service", "Category", "Price", "Duration", "Description", "Customers can request"] as const;
const FIELD_FOR_HEADER: Record<string, ServiceField> = {
  service: "name",
  name: "name",
  category: "category",
  price: "price",
  duration: "duration",
  description: "description",
  "customers can request": "requestable",
  "can request": "requestable",
  requestable: "requestable",
};

const csvCell = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

// The list as CSV, with the template's headers: an empty list is the
// template itself. Spreadsheets open it as a table.
export function servicesToCsv(rows: ServiceRow[]): string {
  const lines = [CSV_HEADERS.join(",")];
  for (const r of rows) lines.push([r.name, r.category, r.price, r.duration, r.description, r.requestable ? "yes" : "no"].map(csvCell).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

// RFC 4180: quoted cells may hold commas, quotes ("") and line breaks.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const YES = new Set(["yes", "y", "true", "1", "✓", "x"]);
const NO = new Set(["no", "n", "false", "0", ""]);

// A CSV file (the template, from any spreadsheet) as rows, not yet
// validated. The header row names the columns, in any order; "Service" is
// required, the others are optional. "Customers can request": yes or no
// (empty means no; a missing column means yes).
export function parseServicesCsv(text: string): { ok: true; rows: ServiceRow[] } | { ok: false; error: string } {
  const lines = parseCsv(text.replace(/^﻿/, ""));
  if (lines.length === 0) return { ok: false, error: "The file is empty." };
  const fields = lines[0].map((h) => FIELD_FOR_HEADER[h.trim().toLowerCase()]);
  if (!fields.includes("name")) return { ok: false, error: `The first row must name the columns, with a "Service" column. Download the template to see the format.` };
  const rows: ServiceRow[] = [];
  for (const [n, cells] of lines.slice(1).entries()) {
    const row = emptyRow();
    for (const [i, field] of fields.entries()) {
      if (!field) continue;
      const value = (cells[i] ?? "").trim();
      if (field === "requestable") {
        const v = value.toLowerCase();
        if (!YES.has(v) && !NO.has(v)) return { ok: false, error: `Row ${n + 2}: "Customers can request" must be yes or no.` };
        row.requestable = YES.has(v);
      } else row[field] = value;
    }
    rows.push(row);
  }
  return { ok: true, rows };
}
