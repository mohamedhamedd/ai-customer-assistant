import "server-only";
import { createHash } from "node:crypto";
import { PDFParse } from "pdf-parse";
import type { SourceType } from "./chunk";

export type ExtractErrorCode = "unsupported_type" | "unsupported_encoding" | "scanned_pdf" | "empty" | "parse_failed";

// Thrown for files we cannot turn into text. The code maps to a message the
// admin sees; the pipeline records it on the document row.
export class ExtractError extends Error {
  constructor(
    public readonly code: ExtractErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ExtractError";
  }
}

const EXTENSIONS: Record<string, SourceType> = { ".txt": "txt", ".md": "md", ".markdown": "md", ".pdf": "pdf" };

export function sourceTypeFromFilename(filename: string): SourceType | null {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return null;
  return EXTENSIONS[filename.slice(dot).toLowerCase()] ?? null;
}

export function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

// A text PDF yields hundreds of letters per page; a scanned one yields almost
// none (or OCR garbage). Below this density we refuse rather than index noise.
const MIN_LETTERS_PER_PAGE = 40;

export interface ExtractedText {
  text: string;
  // sha256 of the normalised text: the document's identity for dedupe (I6).
  contentHash: string;
}

export async function extractText(data: Buffer, sourceType: SourceType): Promise<ExtractedText> {
  const raw = sourceType === "pdf" ? await extractPdf(data) : decodeText(data);
  const text = normalise(raw);
  if (text.length === 0) throw new ExtractError("empty", "The file contains no text.");
  return { text, contentHash: sha256(text) };
}

// Text files are expected in UTF-8. A UTF-16 BOM is honoured; anything else
// that decodes to replacement characters (Windows-1252 and friends) is
// refused rather than indexed as mojibake.
function decodeText(data: Buffer): string {
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) return data.subarray(2).toString("utf16le");
  if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) return data.subarray(2).swap16().toString("utf16le");
  const text = data.toString("utf8");
  const bad = (text.match(/�/g) ?? []).length;
  if (bad > 0 && bad / text.length > 0.002) {
    throw new ExtractError("unsupported_encoding", "The file is not UTF-8 encoded. Save it as UTF-8 and upload again.");
  }
  return text;
}

async function extractPdf(data: Buffer): Promise<string> {
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    const letters = (result.text.match(/\p{L}/gu) ?? []).length;
    const pages = Math.max(result.total, 1);
    if (letters / pages < MIN_LETTERS_PER_PAGE) {
      throw new ExtractError(
        "scanned_pdf",
        "This PDF looks scanned: no text could be read. Upload a text-based PDF, .txt or .md file.",
      );
    }
    return result.text;
  } catch (err) {
    if (err instanceof ExtractError) throw err;
    throw new ExtractError("parse_failed", `Could not read the PDF: ${(err as Error).message}`);
  } finally {
    await parser.destroy();
  }
}

function normalise(text: string): string {
  return text
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

// Admins can rename later; this just avoids "services.md" as a title.
export function deriveTitle(text: string, filename: string, sourceType: SourceType): string {
  if (sourceType === "md") {
    const h1 = /^#\s+(.+?)\s*#*\s*$/m.exec(text);
    if (h1) return h1[1].trim();
  } else {
    const firstLine = text.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";
    if (firstLine.length > 0 && firstLine.length <= 100 && !/[.!?]$/.test(firstLine)) return firstLine;
  }
  const base = filename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
  return base.charAt(0).toUpperCase() + base.slice(1);
}
