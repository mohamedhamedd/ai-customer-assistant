import "server-only";
import { db } from "@/lib/db/supabase";
import { env } from "@/lib/env";
import { chunkDocument } from "./chunk";
import { deriveTitle, ExtractError, extractText, sha256, sourceTypeFromFilename } from "./extract";
import { embedTexts } from "./embed";

// A 'processing' row older than this is a crashed ingestion (design doc §6.1).
export const STALE_PROCESSING_MS = 10 * 60 * 1000;

export interface IngestInput {
  businessId: string;
  filename: string;
  data: Buffer;
  // Optional override; otherwise derived from the content (H1 / first line).
  title?: string;
  // Admin chose to replace an existing document with this one (§6.1).
  replacesDocumentId?: string;
}

export type IngestResult =
  | { status: "ready"; documentId: string; title: string; chunkCount: number }
  | { status: "duplicate"; documentId: string; title: string }
  // A different document already has this title; the admin can replace it.
  | { status: "title_taken"; existingDocumentId: string; title: string; error: string }
  | { status: "failed"; documentId?: string; title: string; error: string };

export const titleTakenMessage = (title: string) => `A document called “${title}” already exists. Replace it with this file, or delete it first.`;

// Document lifecycle: processing -> ready | failed. Chunks are committed in
// one transaction (commit_document_chunks), so a failure never leaves a
// partially indexed document.
export async function ingestDocument(input: IngestInput): Promise<IngestResult> {
  const sourceType = sourceTypeFromFilename(input.filename);
  if (!sourceType) {
    return { status: "failed", title: input.title ?? input.filename, error: "Unsupported file type. Use .txt, .md or .pdf." };
  }

  let text: string;
  let contentHash: string;
  try {
    ({ text, contentHash } = await extractText(input.data, sourceType));
  } catch (err) {
    // No text to hash, so the raw bytes identify the file for dedupe.
    const title = input.title ?? deriveTitle("", input.filename, sourceType);
    const message = err instanceof ExtractError ? err.message : "Could not read the file. Check it opens correctly and try again.";
    if (!(err instanceof ExtractError)) console.error("[ingest] extraction failed", err);
    const documentId = await recordFailure(input.businessId, title, sourceType, sha256(input.data), message);
    return { status: "failed", documentId, title, error: message };
  }

  const title = input.title ?? deriveTitle(text, input.filename, sourceType);
  const embeddingModel = env().OPENAI_EMBEDDING_MODEL;

  // Vectors from different models are not comparable (design L5): a business's
  // knowledge base must be indexed with one model, or search is meaningless.
  const { data: other } = await db()
    .from("documents")
    .select("embedding_model")
    .eq("business_id", input.businessId)
    .eq("status", "ready")
    .neq("embedding_model", embeddingModel)
    .limit(1)
    .maybeSingle();
  if (other) {
    return {
      status: "failed",
      title,
      error: `The knowledge base was indexed with ${other.embedding_model} but OPENAI_EMBEDDING_MODEL is ${embeddingModel}. Re-index all documents with one model.`,
    };
  }

  const existing = await clearPrior(input.businessId, contentHash);
  if (existing.kind === "ready") return { status: "duplicate", documentId: existing.id, title };
  if (existing.kind === "in_progress") {
    return { status: "failed", documentId: existing.id, title, error: IN_PROGRESS_MESSAGE };
  }

  // Same title, different content (an updated price list): ask before
  // anything is embedded, so a mistaken upload costs nothing. The commit
  // still enforces this (documents_ready_title_idx) if two uploads race.
  if (!input.replacesDocumentId) {
    const taken = await readyDocumentTitled(input.businessId, title);
    if (taken) return { status: "title_taken", existingDocumentId: taken, title, error: titleTakenMessage(title) };
  }

  const { data: doc, error: insertError } = await db()
    .from("documents")
    .insert({ business_id: input.businessId, title, source_type: sourceType, content_hash: contentHash, embedding_model: embeddingModel })
    .select("id")
    .single();
  if (insertError) {
    // Lost a race with a concurrent upload of the same content (I6): the
    // other one is either done or still running. Report it as such.
    if (insertError.message.includes("documents_business_id_content_hash_key")) {
      const again = await clearPrior(input.businessId, contentHash);
      if (again.kind === "ready") return { status: "duplicate", documentId: again.id, title };
      return { status: "failed", title, error: IN_PROGRESS_MESSAGE };
    }
    console.error("[ingest] insert failed", insertError);
    return { status: "failed", title, error: PROCESSING_FAILED };
  }

  try {
    const chunks = chunkDocument({ title, text, sourceType });
    if (chunks.length === 0) throw new ExtractError("empty", "The file contains no text to index.");

    // Every embedding is computed before anything is written (§6.1).
    const vectors = await embedTexts(chunks.map((c) => c.embeddingInput));

    const { data: count, error: commitError } = await db().rpc("commit_document_chunks", {
      p_document_id: doc.id,
      p_chunks: chunks.map((c, i) => ({
        chunk_index: c.index,
        heading: c.heading,
        content: c.content,
        token_count: c.tokenCount,
        embedding: vectors[i],
      })),
      p_replaces_document_id: input.replacesDocumentId,
    });
    // Raw: the catch below recognises the title and deleted cases by name.
    if (commitError) throw new Error(commitError.message);

    return { status: "ready", documentId: doc.id, title, chunkCount: count ?? chunks.length };
  } catch (err) {
    console.error(`[ingest] document ${doc.id} ("${title}") failed:`, err);
    const raw = err instanceof Error ? err.message : String(err);
    if (raw.includes("documents_ready_title_idx")) {
      // Lost a race with another upload of the same title.
      await db().from("documents").delete().eq("id", doc.id);
      const taken = await readyDocumentTitled(input.businessId, title);
      if (taken) return { status: "title_taken", existingDocumentId: taken, title, error: titleTakenMessage(title) };
    }
    if (raw.includes("is not in processing state")) {
      // Deleted (or declared stale) while it was being processed: no row left to mark.
      return { status: "failed", title, error: "This document was deleted while it was being processed." };
    }
    // What the admin sees is a plain message; the details are in the log above.
    const message = err instanceof ExtractError ? err.message : PROCESSING_FAILED;
    await db().from("documents").update({ status: "failed", error: message }).eq("id", doc.id);
    return { status: "failed", documentId: doc.id, title, error: message };
  }
}

const PROCESSING_FAILED = "Processing failed. Please try again in a moment.";

async function readyDocumentTitled(businessId: string, title: string): Promise<string | null> {
  // A business has tens of documents: compare in code, exactly like the
  // unique index does (lower(btrim(title))).
  const { data, error } = await db().from("documents").select("id, title").eq("business_id", businessId).eq("status", "ready");
  if (error) throw new Error(`Checking titles failed: ${error.message}`);
  const key = title.trim().toLowerCase();
  return data?.find((d) => d.title.trim().toLowerCase() === key)?.id ?? null;
}

const IN_PROGRESS_MESSAGE = "A copy of this document is still being processed. Try again in a few minutes.";

type Prior = { kind: "none" } | { kind: "ready"; id: string } | { kind: "in_progress"; id: string };

// Dedupe by content hash (I6). A failed or stale earlier attempt is removed so
// the upload can be retried; a fresh 'processing' row is left alone.
async function clearPrior(businessId: string, contentHash: string): Promise<Prior> {
  const { data: prior, error } = await db()
    .from("documents")
    .select("id, status, created_at")
    .eq("business_id", businessId)
    .eq("content_hash", contentHash)
    .maybeSingle();
  if (error) throw new Error(friendlyDbError(error.message));
  if (!prior) return { kind: "none" };
  if (prior.status === "ready") return { kind: "ready", id: prior.id };

  const stale = Date.now() - new Date(prior.created_at).getTime() > STALE_PROCESSING_MS;
  if (prior.status === "processing" && !stale) return { kind: "in_progress", id: prior.id };

  await db().from("documents").delete().eq("id", prior.id);
  return { kind: "none" };
}

async function recordFailure(businessId: string, title: string, sourceType: "txt" | "md" | "pdf", hash: string, message: string) {
  await db().from("documents").delete().eq("business_id", businessId).eq("content_hash", hash).neq("status", "ready");
  const { data } = await db()
    .from("documents")
    .insert({ business_id: businessId, title, source_type: sourceType, content_hash: hash, embedding_model: env().OPENAI_EMBEDDING_MODEL, status: "failed", error: message })
    .select("id")
    .single();
  return data?.id;
}

// Constraint names come from the migration; map the ones an upload can hit.
// Anything else is logged and reported plainly (the admin API has no login,
// so internal details must not end up on the document row).
function friendlyDbError(message: string): string {
  if (message.includes("documents_ready_title_idx")) {
    return "A document with this title already exists. Replace it, or delete it first.";
  }
  console.error(`[ingest] database error: ${message}`);
  return PROCESSING_FAILED;
}
