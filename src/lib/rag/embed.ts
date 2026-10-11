import "server-only";
import { openai } from "@/lib/openai";
import { env } from "@/lib/env";

// Must match the vector(1536) column; a different model dimension needs a
// migration (design doc L5).
export const EMBEDDING_DIMENSIONS = 1536;

// Inputs per request. The API allows up to 2048; a smaller batch keeps each
// request well inside the per-request token limit for long chunks.
const BATCH_SIZE = 64;

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const model = env().OPENAI_EMBEDDING_MODEL;
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await openai().embeddings.create({ model, input: batch, dimensions: EMBEDDING_DIMENSIONS });
    // The API returns one embedding per input, indexed; keep our order.
    const byIndex = [...res.data].sort((a, b) => a.index - b.index);
    for (const item of byIndex) out.push(validate(item.embedding));
  }
  if (out.length !== texts.length) throw new Error(`Embedding count mismatch: expected ${texts.length}, got ${out.length}`);
  return out;
}

function validate(vector: number[]): number[] {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Embedding has ${vector.length} dimensions, expected ${EMBEDDING_DIMENSIONS}`);
  }
  if (!vector.every(Number.isFinite)) throw new Error("Embedding contains a non-finite value");
  return vector;
}
