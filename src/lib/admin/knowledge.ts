import "server-only";
import { db } from "@/lib/db/supabase";
import { ChatHttpError } from "@/lib/chat/turn";
import { embedTexts } from "@/lib/rag/embed";
import { ingestDocument, type IngestResult } from "@/lib/rag/ingest";
import { DEFAULT_FOUND_RULE, isFound, searchChunks } from "@/lib/rag/retrieve";
import { checkUpload } from "@/lib/rag/file-types";

// The admin's knowledge base (US-7.x). Every query is scoped to one business
// (the slug in the URL): an id from another business is "not found".
// Ingestion is the same pipeline as the CLI (`npm run ingest`).

export interface DocumentRow {
  id: string;
  title: string;
  sourceType: "txt" | "md" | "pdf";
  status: "processing" | "ready" | "failed";
  error: string | null;
  sections: number;
  uploadedAt: string;
}

export async function listDocuments(businessId: string): Promise<DocumentRow[]> {
  const { data, error } = await db()
    .from("documents")
    .select("id, title, source_type, status, error, chunk_count, created_at")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    // A small business has tens of documents; the cap keeps the page bounded.
    .limit(500);
  if (error) throw new Error(`Loading documents failed: ${error.message}`);
  return (data ?? []).map((d) => ({
    id: d.id,
    title: d.title,
    sourceType: d.source_type as DocumentRow["sourceType"],
    status: d.status as DocumentRow["status"],
    error: d.error,
    sections: d.chunk_count,
    uploadedAt: d.created_at,
  }));
}

// Synchronous: the request returns when the document is Ready or Failed
// (a few seconds: extract, chunk, embed, one commit). Fine for a handful of
// files at a time; the next step for large volumes is a job queue.
export async function uploadDocument(businessId: string, file: File): Promise<IngestResult> {
  // Checked before anything is read or stored (the page checks first too).
  const problem = checkUpload(file.name, file.size);
  if (problem) throw new ChatHttpError(400, problem);
  return ingestDocument({ businessId, filename: file.name, data: Buffer.from(await file.arrayBuffer()) });
}

// Deleting a document cascades to its chunks, so the assistant stops using
// it at once (retrieval only reads chunks). Answers already given keep their
// citation snapshots (design §3.5).
export async function deleteDocument(businessId: string, documentId: string): Promise<void> {
  const { data, error } = await db().from("documents").delete().eq("business_id", businessId).eq("id", documentId).select("id");
  if (error) throw new Error(`Deleting document failed: ${error.message}`);
  if (!data?.length) throw new ChatHttpError(404, "That document doesn't exist.");
}

// How the document was split (US-7.4): its sections in order.
export async function documentSections(businessId: string, documentId: string) {
  const { data: doc, error } = await db()
    .from("documents")
    .select("id, title, source_type, status, chunk_count, created_at")
    .eq("business_id", businessId)
    .eq("id", documentId)
    .maybeSingle();
  if (error) throw new Error(`Loading document failed: ${error.message}`);
  if (!doc) throw new ChatHttpError(404, "That document doesn't exist.");
  const { data: chunks, error: chunkError } = await db()
    .from("chunks")
    .select("chunk_index, heading, content, token_count")
    .eq("document_id", documentId)
    .order("chunk_index");
  if (chunkError) throw new Error(`Loading sections failed: ${chunkError.message}`);
  return {
    id: doc.id,
    title: doc.title,
    sourceType: doc.source_type,
    uploadedAt: doc.created_at,
    sections: (chunks ?? []).map((c) => ({ index: c.chunk_index, heading: c.heading, content: c.content, tokens: c.token_count })),
  };
}

export const TEST_SEARCH_RESULTS = 5;

// What the assistant would find for a question (US-7.5): the same hybrid
// search and the same "found" rule as the search_knowledge tool, so the
// admin sees whether it would answer or say it doesn't know.
export async function testSearch(businessId: string, query: string) {
  const [embedding] = await embedTexts([query]);
  const chunks = await searchChunks(businessId, embedding, query, TEST_SEARCH_RESULTS);
  return {
    found: isFound(chunks, DEFAULT_FOUND_RULE),
    results: chunks.map((c) => ({
      documentId: c.documentId,
      title: c.documentTitle,
      heading: c.heading,
      excerpt: c.content.length > 280 ? `${c.content.slice(0, 280)}…` : c.content,
      similarity: c.similarity,
    })),
  };
}
