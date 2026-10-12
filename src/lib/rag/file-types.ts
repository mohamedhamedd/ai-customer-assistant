import type { SourceType } from "./chunk";

// Which files the knowledge base accepts. No server imports: the admin page
// checks a file with the same rules before uploading it, and the server
// checks again before reading it.

const EXTENSIONS: Record<string, SourceType> = { ".txt": "txt", ".md": "md", ".markdown": "md", ".pdf": "pdf" };

export const ACCEPTED_EXTENSIONS = Object.keys(EXTENSIONS).join(",");

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function sourceTypeFromFilename(filename: string): SourceType | null {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return null;
  return EXTENSIONS[filename.slice(dot).toLowerCase()] ?? null;
}

// Why a file can't be uploaded, or null if it can.
export function checkUpload(filename: string, size: number): string | null {
  if (!sourceTypeFromFilename(filename)) return "Unsupported file type. Use .txt, .md or a text-based .pdf.";
  if (size === 0) return "The file is empty.";
  if (size > MAX_UPLOAD_BYTES) return "The file is larger than 10 MB.";
  return null;
}
