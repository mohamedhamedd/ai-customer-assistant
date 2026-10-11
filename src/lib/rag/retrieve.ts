import "server-only";
import { db } from "@/lib/db/supabase";
import { embedTexts } from "./embed";

// The "found" decision (design D-03, layer 2). Numbers come from the eval
// script (npm run eval:retrieval) over the sample clinic, not from guesses:
//
// - Vector similarity alone cannot separate answerable from out-of-scope
//   questions: the weakest correct answer ("What's your phone number?")
//   scored 0.27 while the best wrong chunk for "laser eye surgery?" scored
//   0.41. Any single threshold refuses real questions or admits noise.
// - A keyword hit on a topic word is the discriminator: an exact term either
//   occurs in the knowledge base or it doesn't (keyword_query() in SQL drops
//   corpus-generic words and question-frame verbs so "offer"/"have" can't
//   count as a hit). A result is found when the top candidate has such a
//   hit and a sane similarity, or when similarity alone is unambiguous.
//
// This gate filters noise; it is not the last line of defence. The system
// prompt still requires the model to answer only from the retrieved text and
// to say when that text doesn't cover the question.
export interface FoundRule {
  // Below this the top candidate is noise whatever the keywords say.
  minSimilarity: number;
  // At or above this, similarity alone is convincing (no keyword needed).
  strongSimilarity: number;
}

export const DEFAULT_FOUND_RULE: FoundRule = { minSimilarity: 0.2, strongSimilarity: 0.55 };

export interface RetrievedChunk {
  chunkId: number;
  documentId: string;
  documentTitle: string;
  heading: string;
  content: string;
  similarity: number;
  keywordRank: number;
  score: number;
}

// What the UI shows as a citation: a self-contained snapshot (design §3.5).
export interface Source {
  documentId: string;
  title: string;
  heading: string;
  excerpt: string;
  similarity: number;
}

export interface RetrievalResult {
  found: boolean;
  chunks: RetrievedChunk[];
  sources: Source[];
}

export interface RetrieveOptions {
  matchCount?: number;
  rule?: FoundRule;
}

export async function retrieve(businessId: string, query: string, options: RetrieveOptions = {}): Promise<RetrievalResult> {
  const text = query.trim();
  if (text.length < 2) return { found: false, chunks: [], sources: [] };

  const [embedding] = await embedTexts([text]);
  const chunks = await searchChunks(businessId, embedding, text, options.matchCount ?? 6);
  const found = isFound(chunks, options.rule ?? DEFAULT_FOUND_RULE);
  return { found, chunks, sources: found ? toSources(chunks) : [] };
}

// Exposed separately so the eval script can reuse one query embedding.
export async function searchChunks(
  businessId: string,
  embedding: number[],
  text: string,
  matchCount: number,
): Promise<RetrievedChunk[]> {
  const { data, error } = await db().rpc("hybrid_search", {
    p_business_id: businessId,
    p_query_embedding: JSON.stringify(embedding),
    p_query_text: text,
    p_match_count: matchCount,
  });
  if (error) throw new Error(`Retrieval failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    chunkId: r.chunk_id,
    documentId: r.document_id,
    documentTitle: r.document_title,
    heading: r.heading,
    content: r.content,
    similarity: r.similarity,
    keywordRank: r.keyword_rank,
    score: r.score,
  }));
}

export function isFound(chunks: RetrievedChunk[], rule: FoundRule): boolean {
  const top = chunks[0];
  if (!top || top.similarity < rule.minSimilarity) return false;
  return top.keywordRank > 0 || top.similarity >= rule.strongSimilarity;
}

function toSources(chunks: RetrievedChunk[]): Source[] {
  // One citation per document section, best score first.
  const seen = new Set<string>();
  const sources: Source[] = [];
  for (const c of chunks) {
    const key = `${c.documentId}:${c.heading}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({ documentId: c.documentId, title: c.documentTitle, heading: c.heading, excerpt: c.content, similarity: c.similarity });
  }
  return sources;
}
