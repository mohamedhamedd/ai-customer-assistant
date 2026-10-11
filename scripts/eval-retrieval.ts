// Retrieval evaluation over data/sample-clinic/eval.json.
//
//   npm run eval:retrieval
//
// For every question it reports, for vector-only and hybrid retrieval, whether
// the expected section is the top hit / in the top 3, and for out-of-scope
// questions whether the found-rule correctly says "not found". It also prints
// the similarity margin between the weakest correct answer and the strongest
// wrong one, which is what decides whether a threshold can work at all.
import { readFile } from "node:fs/promises";
import { db } from "@/lib/db/supabase";
import { env } from "@/lib/env";
import { embedTexts } from "@/lib/rag/embed";
import { DEFAULT_FOUND_RULE, DEFAULT_MATCH_COUNT, isFound, searchChunks, type RetrievedChunk } from "@/lib/rag/retrieve";

interface Expect {
  title: string;
  heading: string;
}
interface Question {
  q: string;
  expect?: Expect;
  gap?: boolean;
}

const K = DEFAULT_MATCH_COUNT;

async function main() {
  const file = process.argv[2] ?? "data/sample-clinic/eval.json";
  const { questions } = JSON.parse(await readFile(file, "utf8")) as { questions: Question[] };

  const { data: business } = await db().from("businesses").select("id, name").eq("slug", env().DEMO_BUSINESS_SLUG).single();
  if (!business) throw new Error("Demo business not found; run npm run db:reset and npm run ingest.");

  const embeddings = await embedTexts(questions.map((x) => x.q));

  const rows: Array<{ q: Question; vec: RetrievedChunk[]; hyb: RetrievedChunk[] }> = [];
  for (const [i, q] of questions.entries()) {
    const { data, error } = await db().rpc("match_chunks", {
      p_business_id: business.id,
      p_query_embedding: JSON.stringify(embeddings[i]),
      p_match_count: K,
      p_min_similarity: 0,
    });
    if (error) throw new Error(error.message);
    const vec: RetrievedChunk[] = (data ?? []).map((r) => ({
      chunkId: r.chunk_id, documentId: r.document_id, documentTitle: r.document_title, heading: r.heading,
      content: r.content, similarity: r.similarity, keywordRank: 0, score: r.similarity,
    }));
    const hyb = await searchChunks(business.id, embeddings[i], q.q, K);
    rows.push({ q, vec, hyb });
  }

  const matches = (c: RetrievedChunk, e: Expect) =>
    c.documentTitle.toLowerCase().includes(e.title.toLowerCase()) && c.heading.toLowerCase().includes(e.heading.toLowerCase());
  const rankOf = (list: RetrievedChunk[], e: Expect) => list.findIndex((c) => matches(c, e)) + 1; // 0 = miss

  console.log(`Business: ${business.name}   questions: ${questions.length}   k=${K}   rule: ${JSON.stringify(DEFAULT_FOUND_RULE)}\n`);
  console.log("  #  question                                        vector     hybrid    top-sim  kw   found  expected");
  const summary = { pos: 0, vecTop1: 0, vecTop3: 0, hybTop1: 0, hybTop3: 0, hybTopK: 0, foundOk: 0, gaps: 0, gapOk: 0 };
  const positiveTopSims: number[] = [];
  const gapTopSims: number[] = [];

  rows.forEach(({ q, vec, hyb }, i) => {
    const top = hyb[0];
    const found = isFound(hyb, DEFAULT_FOUND_RULE);
    const topSim = top?.similarity ?? 0;
    const kw = top && top.keywordRank > 0 ? "yes" : "no ";
    let verdict: string;
    let detail: string;
    if (q.gap) {
      summary.gaps++;
      gapTopSims.push(topSim);
      const ok = !found;
      if (ok) summary.gapOk++;
      verdict = ok ? "OK " : "BAD";
      detail = `(gap)  top: ${top ? `${short(top.documentTitle)} › ${top.heading}` : "-"}`;
      console.log(`${String(i + 1).padStart(3)}  ${q.q.padEnd(46)} ${"-".padEnd(10)} ${"-".padEnd(9)} ${topSim.toFixed(3)}   ${kw}  ${verdict} ${verdict === "OK " ? "not found" : "FOUND"}  ${detail}`);
      return;
    }
    const e = q.expect!;
    summary.pos++;
    positiveTopSims.push(topSim);
    const rv = rankOf(vec, e);
    const rh = rankOf(hyb, e);
    if (rv === 1) summary.vecTop1++;
    if (rv >= 1 && rv <= 3) summary.vecTop3++;
    if (rh === 1) summary.hybTop1++;
    if (rh >= 1 && rh <= 3) summary.hybTop3++;
    if (rh >= 1 && rh <= K) summary.hybTopK++;
    if (found) summary.foundOk++;
    const fmt = (r: number) => (r === 0 ? "miss" : `#${r}`);
    // Pass = the expected section is among the k chunks the model receives.
    verdict = rh >= 1 && rh <= K && found ? "OK " : "BAD";
    detail = `${e.title} › ${e.heading}`;
    console.log(`${String(i + 1).padStart(3)}  ${q.q.padEnd(46)} ${fmt(rv).padEnd(10)} ${fmt(rh).padEnd(9)} ${topSim.toFixed(3)}   ${kw}  ${verdict} ${found ? "found    " : "NOT FOUND"}  ${detail}`);
  });

  const minPos = Math.min(...positiveTopSims);
  const maxGap = Math.max(...gapTopSims);
  console.log(`
Answerable (${summary.pos}):  vector top-1 ${summary.vecTop1}/${summary.pos}, top-3 ${summary.vecTop3}/${summary.pos}   |   hybrid top-1 ${summary.hybTop1}/${summary.pos}, top-3 ${summary.hybTop3}/${summary.pos}, top-${K} ${summary.hybTopK}/${summary.pos}   |   found-rule says found: ${summary.foundOk}/${summary.pos}
Out of scope (${summary.gaps}): found-rule says not found: ${summary.gapOk}/${summary.gaps}

Similarity margin: weakest correct top-sim ${minPos.toFixed(3)} vs strongest out-of-scope top-sim ${maxGap.toFixed(3)} → ${
    minPos > maxGap ? "a pure similarity threshold COULD separate them" : "NO single similarity threshold can separate them; the keyword signal is required"
  }`);

  const failures = summary.pos - summary.hybTopK + (summary.pos - summary.foundOk) + (summary.gaps - summary.gapOk);
  process.exit(failures === 0 ? 0 : 1);
}

function short(title: string) {
  return title.replace("Lakeside Dental Clinic — ", "");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
