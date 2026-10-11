// Heading-aware chunker (design doc D-04). Pure: no I/O, no env, so it is
// unit-tested directly.
//
// Strategy: split the document into sections by heading, then pack each
// section's paragraphs into chunks of roughly targetTokens (never more than
// maxTokens). A section boundary is always a chunk boundary, so a FAQ answer
// or a price table is never cut in half. Only when a single section exceeds
// maxTokens is it split, with a sentence-level overlap between the pieces.
import { getEncoding, type Tiktoken } from "js-tiktoken";

export type SourceType = "txt" | "md" | "pdf";

export interface ChunkOptions {
  // Flush a chunk once it reaches this size...
  targetTokens: number;
  // ...and never let one exceed this (the embedding model's useful range).
  maxTokens: number;
  // Trailing sentences of one chunk repeated at the start of the next, so a
  // fact that straddles the boundary is whole in at least one of them.
  overlapTokens: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { targetTokens: 450, maxTokens: 500, overlapTokens: 60 };

export interface Chunk {
  index: number;
  // Section path, e.g. "Cosmetic dentistry › Teeth whitening". Shown in source chips.
  heading: string;
  // The text shown to the model and in source previews.
  content: string;
  tokenCount: number;
  // What is embedded: title and heading in front of the content, so a short
  // chunk like "$349" still retrieves for "whitening price".
  embeddingInput: string;
}

export interface ChunkInput {
  title: string;
  text: string;
  sourceType: SourceType;
}

interface Section {
  path: string[];
  blocks: string[];
}

interface Unit {
  text: string;
  tokens: number;
  // Joined to the previous unit with a blank line (true) or a space (false).
  startsParagraph: boolean;
}

// text-embedding-3-* models use cl100k_base.
let encoder: Tiktoken | undefined;
function enc(): Tiktoken {
  return (encoder ??= getEncoding("cl100k_base"));
}

export function countTokens(text: string): number {
  return enc().encode(text).length;
}

export function chunkDocument(input: ChunkInput, options: Partial<ChunkOptions> = {}): Chunk[] {
  const opts = { ...DEFAULT_CHUNK_OPTIONS, ...options };
  const sections = input.sourceType === "md" ? markdownSections(input.text) : plainSections(input.text);
  const chunks: Chunk[] = [];
  for (const section of sections) {
    for (const chunk of packSection(section, input.title, opts, chunks.length)) chunks.push(chunk);
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Sectioning
// ---------------------------------------------------------------------------

const MD_HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

function markdownSections(text: string): Section[] {
  const lines = text.split("\n");
  // A single H1 is the document's title, not a section of it.
  const skipH1 = lines.filter((l) => /^#\s+/.test(l)).length === 1;

  const sections: Section[] = [];
  const stack: { level: number; title: string }[] = [];
  let current: Section = { path: [], blocks: [] };
  let block: string[] = [];
  let inFence = false;

  const flushBlock = () => {
    const joined = block.join("\n").trim();
    if (joined) current.blocks.push(joined);
    block = [];
  };
  const endSection = () => {
    flushBlock();
    if (current.blocks.length) sections.push(current);
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      inFence = !inFence;
      block.push(line);
      continue;
    }
    const m = inFence ? null : MD_HEADING.exec(line);
    if (m) {
      endSection();
      const level = m[1].length;
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      if (!(skipH1 && level === 1)) stack.push({ level, title: m[2].trim() });
      current = { path: stack.map((s) => s.title), blocks: [] };
      continue;
    }
    if (line.trim() === "") {
      flushBlock();
      continue;
    }
    block.push(line);
  }
  endSection();
  return sections;
}

// PDFs and .txt have no markup. Paragraphs are blank-line separated; a short
// numbered line ("3. Late arrival") that doesn't continue a sentence is
// treated as a heading, which recovers the structure of most policy-style
// documents. Hard-wrapped lines are re-joined.
const NUMBERED_HEADING = /^\d+(?:\.\d+)*\.?\s+[A-Z][^.!?:]{2,80}$/;

function plainSections(text: string): Section[] {
  const sections: Section[] = [];
  let current: Section = { path: [], blocks: [] };
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) current.blocks.push(joinWrapped(para));
    para = [];
  };
  const endSection = () => {
    flushPara();
    if (current.blocks.length) sections.push(current);
  };

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") {
      flushPara();
      continue;
    }
    const sentenceEnded = para.length === 0 || /[.!?:]$/.test(para[para.length - 1]);
    if (sentenceEnded && NUMBERED_HEADING.test(line)) {
      endSection();
      current = { path: [line], blocks: [] };
      continue;
    }
    para.push(line);
  }
  endSection();
  return sections;
}

function joinWrapped(lines: string[]): string {
  // "in-\noffice" -> "in-office"; everything else gets a space.
  return lines.reduce((acc, l) => (acc === "" ? l : acc.endsWith("-") ? acc + l : `${acc} ${l}`), "");
}

// ---------------------------------------------------------------------------
// Packing
// ---------------------------------------------------------------------------

function packSection(section: Section, title: string, opts: ChunkOptions, startIndex: number): Chunk[] {
  const units = section.blocks.flatMap((b) => toUnits(b, opts.maxTokens));
  const heading = section.path.join(" › ");
  const chunks: Chunk[] = [];

  // Tokens remaining from unit i onwards, so we can avoid flushing at the
  // target when the whole rest of the section would still fit under max.
  const remaining = new Array<number>(units.length + 1).fill(0);
  for (let i = units.length - 1; i >= 0; i--) remaining[i] = remaining[i + 1] + units[i].tokens;

  let current: Unit[] = [];
  let currentTokens = 0;
  let fresh = 0; // units added since the last flush (excludes carried overlap)

  const flush = () => {
    if (fresh === 0) return;
    chunks.push(makeChunk(current, heading, title, startIndex + chunks.length));
    const carry = overlapTail(current, opts.overlapTokens);
    current = carry.units;
    currentTokens = carry.tokens;
    fresh = 0;
  };

  units.forEach((unit, i) => {
    if (fresh > 0 && currentTokens + unit.tokens > opts.maxTokens) flush();
    current.push(unit);
    currentTokens += unit.tokens;
    fresh++;
    const restFits = currentTokens + remaining[i + 1] <= opts.maxTokens;
    if (currentTokens >= opts.targetTokens && !restFits) flush();
  });
  flush();
  return chunks;
}

// A block is one unit if it fits. Otherwise split by lines (tables, lists),
// then sentences, then raw tokens as a last resort.
function toUnits(block: string, maxTokens: number, startsParagraph = true): Unit[] {
  const tokens = countTokens(block);
  if (tokens <= maxTokens) return [{ text: block, tokens, startsParagraph }];

  const lines = block.split("\n").filter((l) => l.trim());
  if (lines.length > 1) return lines.flatMap((l, i) => toUnits(l, maxTokens, i === 0 && startsParagraph));

  const sentences = splitSentences(block);
  if (sentences.length > 1) return sentences.flatMap((s, i) => toUnits(s, maxTokens, i === 0 && startsParagraph));

  const ids = enc().encode(block);
  const units: Unit[] = [];
  for (let k = 0; k < ids.length; k += maxTokens) {
    const slice = ids.slice(k, k + maxTokens);
    units.push({ text: enc().decode(slice), tokens: slice.length, startsParagraph: k === 0 && startsParagraph });
  }
  return units;
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=\S)/).filter((s) => s.length > 0);
}

// The last sentences of a chunk, up to the overlap budget.
function overlapTail(units: Unit[], budget: number): { units: Unit[]; tokens: number } {
  const sentences = units.flatMap((u) =>
    splitSentences(u.text).map((s, i) => ({ text: s, tokens: countTokens(s), startsParagraph: i === 0 && u.startsParagraph })),
  );
  const tail: Unit[] = [];
  let total = 0;
  for (let i = sentences.length - 1; i >= 0; i--) {
    if (total + sentences[i].tokens > budget) break;
    tail.unshift(sentences[i]);
    total += sentences[i].tokens;
  }
  if (tail.length) tail[0] = { ...tail[0], startsParagraph: true };
  return { units: tail, tokens: total };
}

function makeChunk(units: Unit[], heading: string, title: string, index: number): Chunk {
  const content = units.reduce((acc, u, i) => (i === 0 ? u.text : acc + (u.startsParagraph ? "\n\n" : " ") + u.text), "");
  const prefix = heading ? `${title} › ${heading}` : title;
  return { index, heading, content, tokenCount: countTokens(content), embeddingInput: `${prefix}\n\n${content}` };
}
