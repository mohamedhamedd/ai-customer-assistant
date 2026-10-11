import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkDocument, countTokens, DEFAULT_CHUNK_OPTIONS } from "./chunk";

const TITLE = "Lakeside Dental Clinic — Services";

function paragraph(n: number, words = 50): string {
  return Array.from({ length: words }, (_, i) => `word${n}_${i}`).join(" ") + ".";
}

test("markdown: sections follow the heading path and the single H1 is the title, not a section", () => {
  const text = `# ${TITLE}

Intro paragraph about the clinic.

## Cosmetic dentistry

### Teeth whitening

In-office whitening takes 60 to 90 minutes.

### Veneers

Veneers are placed over two visits.

## Orthodontics

Invisalign takes 6 to 18 months.`;
  const chunks = chunkDocument({ title: TITLE, text, sourceType: "md" });
  assert.deepEqual(
    chunks.map((c) => c.heading),
    ["", "Cosmetic dentistry › Teeth whitening", "Cosmetic dentistry › Veneers", "Orthodontics"],
  );
  assert.equal(chunks[1].content, "In-office whitening takes 60 to 90 minutes.");
  assert.equal(chunks[1].embeddingInput, `${TITLE} › Cosmetic dentistry › Teeth whitening\n\nIn-office whitening takes 60 to 90 minutes.`);
  assert.deepEqual(chunks.map((c) => c.index), [0, 1, 2, 3]);
});

test("a short section stays whole, and a table is never split", () => {
  const table = ["| Service | Price |", "|---|---|", "| In-office whitening | $349 |", "| Take-home kit | $199 |"].join("\n");
  const text = `## Cosmetic treatment\n\nAll prices in USD.\n\n${table}`;
  const chunks = chunkDocument({ title: "Pricing", text, sourceType: "md" });
  assert.equal(chunks.length, 1);
  assert.ok(chunks[0].content.includes("$349"));
  assert.ok(chunks[0].content.includes("$199"));
  assert.ok(chunks[0].content.includes(table));
});

// Realistic prose: several short sentences per paragraph.
function prose(n: number, sentences = 4): string {
  return Array.from({ length: sentences }, (_, s) => `Paragraph ${n} sentence ${s} says something about the clinic.`).join(" ");
}

test("a long section is split under maxTokens with a sentence overlap between pieces", () => {
  const paras = Array.from({ length: 20 }, (_, i) => prose(i));
  const text = `## Policies\n\n${paras.join("\n\n")}`;
  const chunks = chunkDocument({ title: "Doc", text, sourceType: "md" });

  assert.ok(chunks.length >= 2, `expected a split, got ${chunks.length} chunk(s)`);
  for (const c of chunks) {
    assert.ok(c.tokenCount <= DEFAULT_CHUNK_OPTIONS.maxTokens, `chunk ${c.index} has ${c.tokenCount} tokens`);
    assert.equal(c.heading, "Policies");
  }
  // The second chunk begins with the tail of the first: the longest suffix of
  // chunk 0 that is a prefix of chunk 1 is the overlap.
  const [first, second] = [chunks[0].content, chunks[1].content];
  let overlap = "";
  for (let len = Math.min(first.length, second.length); len > 0; len--) {
    const candidate = second.slice(0, len);
    if (first.endsWith(candidate)) {
      overlap = candidate;
      break;
    }
  }
  const lastSentenceOfFirst = first.split(/(?<=\.)\s+/).at(-1)!;
  assert.ok(overlap.length > 0, `no overlap; chunk 1 starts: ${second.slice(0, 60)}`);
  assert.ok(overlap.endsWith(lastSentenceOfFirst));
  assert.ok(countTokens(overlap) <= DEFAULT_CHUNK_OPTIONS.overlapTokens);
  // No chunk consists only of the overlap.
  for (let i = 1; i < chunks.length; i++) assert.ok(chunks[i].tokenCount > countTokens(overlap));
});

test("no overlap is carried when the previous chunk's last sentence exceeds the overlap budget", () => {
  const paras = Array.from({ length: 16 }, (_, i) => paragraph(i, 40)); // one ~160-token sentence each
  const chunks = chunkDocument({ title: "Doc", text: `## S\n\n${paras.join("\n\n")}`, sourceType: "md" });
  assert.ok(chunks.length >= 2);
  const lastOfFirst = chunks[0].content.split("\n\n").at(-1)!;
  assert.ok(!chunks[1].content.includes(lastOfFirst));
});

test("all paragraphs of the section are present across the chunks in order", () => {
  const paras = Array.from({ length: 12 }, (_, i) => paragraph(i, 45));
  const chunks = chunkDocument({ title: "Doc", text: `## S\n\n${paras.join("\n\n")}`, sourceType: "md" });
  const joined = chunks.map((c) => c.content).join("\n");
  let pos = 0;
  for (const p of paras) {
    const idx = joined.indexOf(p, pos);
    assert.ok(idx >= 0, `paragraph missing: ${p.slice(0, 20)}`);
    pos = idx;
  }
});

test("the carried overlap never pushes a chunk over maxTokens", () => {
  // Ten short sentences (an overlap-friendly tail) followed by a paragraph
  // just under the cap: carry + paragraph would exceed maxTokens.
  const short = Array.from({ length: 10 }, (_, s) => `Short sentence number ${s} here.`).join(" ");
  const big = paragraph(1, 117);
  const bigTokens = countTokens(big);
  assert.ok(bigTokens > 430 && bigTokens <= DEFAULT_CHUNK_OPTIONS.maxTokens, `fixture is ${bigTokens} tokens`);

  const chunks = chunkDocument({ title: "Doc", text: `## S\n\n${short}\n\n${big}`, sourceType: "md" });
  assert.equal(chunks.length, 2);
  for (const c of chunks) assert.ok(c.tokenCount <= DEFAULT_CHUNK_OPTIONS.maxTokens, `chunk ${c.index} has ${c.tokenCount} tokens`);
  assert.equal(chunks[1].content, big);
});

test("an oversized table is split by rows and the rows keep their line breaks", () => {
  const rows = Array.from({ length: 120 }, (_, i) => `| Service number ${i} with a long descriptive name | $${100 + i} |`);
  const table = ["| Service | Price |", "|---|---|", ...rows].join("\n");
  const chunks = chunkDocument({ title: "Pricing", text: `## Fees\n\n${table}`, sourceType: "md" });
  assert.ok(chunks.length > 1);
  for (const c of chunks) {
    assert.ok(c.tokenCount <= DEFAULT_CHUNK_OPTIONS.maxTokens);
    assert.ok(c.content.includes("|\n|"), "rows should be newline-separated");
    assert.ok(!c.content.includes("| |"), "rows must not be joined with spaces");
  }
});

test("a single oversized paragraph with no sentence breaks is hard-split by tokens", () => {
  const giant = Array.from({ length: 1500 }, (_, i) => `w${i}`).join(" ");
  const chunks = chunkDocument({ title: "Doc", text: giant, sourceType: "txt" });
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.tokenCount <= DEFAULT_CHUNK_OPTIONS.maxTokens);
});

test("plain text: numbered headings become sections and hard-wrapped lines are re-joined", () => {
  const text = [
    "Lakeside Dental Clinic — Patient Policies",
    "Effective 1 September 2026.",
    "1. Appointments and cancellations",
    "Appointment times are reserved for you. If you need to cancel or",
    "reschedule, please give us notice. The fee applies to in-",
    "office whitening.",
    "2. Late arrival",
    "If you arrive late we may reschedule.",
  ].join("\n");
  const chunks = chunkDocument({ title: "Patient Policies", text, sourceType: "pdf" });
  assert.deepEqual(
    chunks.map((c) => c.heading),
    ["", "1. Appointments and cancellations", "2. Late arrival"],
  );
  assert.equal(
    chunks[1].content,
    "Appointment times are reserved for you. If you need to cancel or reschedule, please give us notice. The fee applies to in-office whitening.",
  );
});

test("plain text: a numbered line that continues a sentence is not a heading", () => {
  const text = ["Prices were last updated in", "2026. Prices may change at any time", "without notice."].join("\n");
  const chunks = chunkDocument({ title: "Doc", text, sourceType: "txt" });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].heading, "");
});

test("empty sections and blank documents produce no chunks", () => {
  assert.deepEqual(chunkDocument({ title: "T", text: "## Only a heading\n\n### And another", sourceType: "md" }), []);
  assert.deepEqual(chunkDocument({ title: "T", text: "   \n\n  ", sourceType: "txt" }), []);
});
