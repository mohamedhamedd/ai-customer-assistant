import "server-only";
import { db } from "@/lib/db/supabase";
import { env } from "@/lib/env";
import { chunkDocument } from "./chunk";
import { deriveTitle, ExtractError, extractText, sha256, sourceTypeFromFilename } from "./extract";
import { embedTexts } from "./embed";

// A 'processing' row older than this is a crashed ingestion (design doc §6.1).
const STALE_PROCESSING_MS = 10 * 60 * 1000;

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
  | { status: "failed"; documentId?: string; title: string; error: string };

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
    const message = err instanceof ExtractError ? err.message : `Could not read the file: ${(err as Error).message}`;
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
    return { status: "failed", title, error: friendlyDbError(insertError.message) };
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
    if (commitError) throw new Error(friendlyDbError(commitError.message));

    return { status: "ready", documentId: doc.id, title, chunkCount: count ?? chunks.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ingest] document ${doc.id} ("${title}") failed:`, err);
    await db().from("documents").update({ status: "failed", error: message }).eq("id", doc.id);
    return { status: "failed", documentId: doc.id, title, error: message };
  }
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
function friendlyDbError(message: string): string {
  if (message.includes("documents_ready_title_idx")) {
    return "A document with this title already exists. Replace it or choose a different title.";
  }
  return `Database error: ${message}`;
}
