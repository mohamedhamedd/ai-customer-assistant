# AI Customer Assistant

An AI assistant for small service businesses. It learns a business from its documents, talks with customers by **text or voice**, answers with **source references**, and **captures leads** and **consultation requests**.

**Stack:** Next.js · TypeScript · Supabase (Postgres + pgvector) · OpenAI (tool calling, embeddings, Realtime voice)

> 🚧 In progress. Sections are added as each PR lands. See the [delivery plan](docs/project-plan.xlsx).

## Prerequisites

- Node.js 20+
- Docker (for local Supabase)
- An OpenAI API key with access to the Realtime API

## Setup

```bash
npm install
cp .env.example .env.local
npm run db:start          # starts Postgres + Supabase APIs in Docker
npx supabase status       # copy API URL and the service_role / secret key into .env.local
```

Add your `OPENAI_API_KEY` to `.env.local`, then:

```bash
npm run dev               # http://localhost:3000
```

The server validates its configuration at startup. If anything is missing or invalid it logs the exact variables and refuses to serve requests.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` / `start` | Production build / server |
| `npm run lint` / `typecheck` | ESLint / TypeScript checks |
| `npm run db:start` / `db:stop` | Start / stop local Supabase |
| `npm run db:reset` | Recreate the local database from migrations + seed |
| `npm run db:status` | Show local Supabase URLs and keys |
| `npm test` / `npm run test:db` | Unit tests (Node) / database tests (pgTAP in `supabase/tests/`, needs Supabase running) |
| `npm run test:integration` | Turn orchestration against the local database with a fake model (`*.itest.ts`, needs Supabase running; no OpenAI calls) |
| `npm run db:types` | Regenerate `src/lib/db/database.types.ts` from the local schema (run after every migration) |

## Database

Schema lives in `supabase/migrations/` as plain SQL; `supabase/seed.sql` inserts the demo business. The design, every constraint and the reasoning behind them are in [docs/database-design.md](docs/database-design.md).

Eight tables in three groups:

| Group | Tables |
|---|---|
| Knowledge | `businesses`, `documents`, `chunks` (pgvector embeddings, HNSW index) |
| Conversation & memory | `conversations`, `messages`, `tool_calls` |
| Agent actions | `leads`, `consultation_requests` |

Business rules the database enforces itself: no duplicate leads per email/phone, no duplicate consultation requests per conversation, no duplicate messages on retry, one live document per title, a lead must have an email or a phone. Row-Level Security is enabled on every table with no policies, so only the server (service role) can read or write.

After changing a migration: `npm run db:reset && npm run db:types`.

## Knowledge base ingestion

```bash
npm run ingest -- ./data/sample-clinic            # demo business (DEMO_BUSINESS_SLUG)
npm run ingest -- ./my-docs --business my-slug
```

Supported: `.txt`, `.md`, text-based `.pdf`. Scanned PDFs and images are rejected with a clear error (they would need OCR or a vision model). The pipeline, in `src/lib/rag/`:

1. **Extract** (`extract.ts`): read the text, normalise it, hash it. A PDF with almost no letters per page is treated as scanned.
2. **Chunk** (`chunk.ts`): split by headings, then pack each section's paragraphs into chunks of about 450 tokens (max 500) with a ~60-token sentence overlap when a section has to be split. A section boundary is always a chunk boundary, so a FAQ answer or a price table is never cut in half. PDFs get light structure recovery (numbered headings, re-joined wrapped lines). Each chunk is embedded with its document title and heading path in front (`Pricing Guide › Cosmetic treatment`), so short chunks still retrieve well.
3. **Embed** (`embed.ts`): `text-embedding-3-small`, batched, every vector validated.
4. **Commit** (`ingest.ts` + `commit_document_chunks()` in SQL): all chunks are inserted and the document marked `ready` in one transaction. A failure leaves zero chunks and a `failed` document with the reason. Re-uploading identical content is a no-op; a failed or crashed (`processing` for over 10 minutes) attempt is replaced on retry.

Chunker unit tests: `npm test`.

## Retrieval

`retrieve(businessId, question)` in `src/lib/rag/retrieve.ts` embeds the question and calls `hybrid_search()`: the top vector matches and the top full-text matches, fused by reciprocal rank. It returns the chunks plus a `found` flag and self-contained citation snapshots (`sources`).

**Why hybrid, and why no plain similarity threshold.** Measured on the sample clinic (`npm run eval:retrieval`), the weakest correct answer scored 0.27 cosine similarity while the best *wrong* chunk for an out-of-scope question scored 0.41. No single threshold can separate those; it would either refuse real questions or admit noise. Keywords can: an exact topic word either occurs in the knowledge base or it doesn't. So a result counts as found when the top candidate matches a topic keyword and clears a low noise floor (0.2), or when similarity alone is unambiguous (≥ 0.55). "Topic keyword" excludes question-frame verbs (*offer, provide, have…*), which otherwise match FAQ headings like "Do you offer sedation?", and prefers words that are specific to the corpus (not in more than 25% of the business's chunks, with a floor of 3 chunks so small knowledge bases keep their keywords). A broad question made only of common words ("What treatments do you have?") falls back to those words, since the corpus evidently covers the topic. Search also refuses to run if the configured embedding model differs from the one the knowledge base was indexed with.

This gate filters noise. The system prompt remains the main defence: the model answers only from the retrieved text and says so when that text doesn't cover the question.

## Chat API

`POST /api/chat` with `{ sessionId, clientMessageId, message }` streams the reply as NDJSON (one JSON event per line): `start`, `delta` (text), `tool` (started/finished), `action` (lead saved, consultation requested, failed), `sources`, `done`, or `error`. `GET /api/chat?sessionId=…` returns the conversation history.

- **Memory:** the browser sends only the new message. The server loads the last 20 messages, what the customer told us (`customer_facts`) and what was already done in the conversation (contact saved, requests with their live status). A client can't inject fake history.
- **Agent loop** (`src/lib/agent/loop.ts`): hand-written over Chat Completions. Model → tool calls (run in order) → results back → repeat, at most 5 tool rounds, then one call with tools off so it must answer. The whole turn has a 45 s deadline, and a tool is only started if its 15 s timeout fits in what's left.
- **One turn at a time:** a second message while the first is still being answered gets 409, enforced in the database with a row lock on the conversation.
- **Retries:** each message carries a `clientMessageId`. Resending it replays a stored reply (no model call), returns 409 while the original is still running, or re-runs it if the original failed or died.
- **Failures:** if the model call fails, the customer gets a friendly message, the message stays saved and is marked failed, and one structured log line records the reason.

## Agent: prompt and tools

`src/lib/agent/` holds everything the model is given, shared by text chat and voice:

- **`prompt.ts`**: the system prompt. It contains the business name and description, the current time in the business's timezone with a 14-day calendar (so "next Tuesday" is a lookup, not arithmetic), and the rules. It contains **no business facts**: prices, hours and services only reach the model through `search_knowledge`, so every factual answer has a retrieved source.
- **`tools.ts`**: three tools, each a JSON schema for the model plus a zod schema that validates and normalises the arguments (lowercase email, digits-only phone, local date → UTC in the business timezone).
  - `search_knowledge`: hybrid retrieval; returns the matching sections, or `found: false`.
  - `save_lead`: records what the customer said on the conversation, then matches or creates the lead. An existing lead is never overwritten (anyone can type any email).
  - `create_consultation_request`: a *request* (status `pending`), deduplicated per conversation, with a snapshot of the requester's contact details.
- **`execute.ts`**: runs a tool call. It never throws: invalid input, a database outage or a timeout all come back to the model as `{ ok: false, error, message }`, so the model can ask for a correction or apologise, and can never mistake a failure for a success. Every call is written to `tool_calls`.

The two write tools are single SQL functions (`save_lead()`, `create_consultation_request()`), so their matching and dedupe rules run atomically. Tool results only contain ids, statuses and values the customer gave in this conversation, never stored lead data, because the model can repeat anything it is shown.

Tests: `npm test` (unit: dates across DST, prompt, validation, the executor's error contract) and `npm run test:db` (pgTAP: lead matching, no-overwrite, collisions, consultation dedupe and snapshot).

The evaluation set is `data/sample-clinic/eval.json` (15 answerable questions with their expected section, 6 out-of-scope ones). The keyword rules themselves, including the small-knowledge-base and broad-question cases the clinic data can't show, are covered by pgTAP tests in `supabase/tests/keyword_query.test.sql` (`npm run test:db`). The script reports top-1 / top-3 hit rates for vector-only and hybrid retrieval, whether the found rule agrees, and the similarity margin.

## Project structure

```
src/
  app/            Next.js routes: customer chat, admin, API route handlers
  lib/
    env.ts        Validated configuration (server-only)
    openai.ts     OpenAI client (server-only)
    db/           Supabase service-role client + data access (server-only)
    rag/          Document extraction, chunking, embeddings, retrieval
    agent/        System prompt, tool definitions, agent loop
  instrumentation.ts  Fails fast at boot on bad configuration
supabase/         Local Supabase config, migrations, seed
data/sample-clinic/  Demo business documents and the demo question/answer map
scripts/          CLI scripts (document ingestion, retrieval eval)
docs/             User stories, UI design brief, delivery plan
```

## Security model

- The browser never talks to Supabase or OpenAI with a secret. All database access goes through server route handlers using the service-role key.
- Every module that touches a secret imports `server-only`, so importing it from client code fails the build.
- Admin pages have no authentication in this version (demo/local use only).

## Planning docs

- [User stories & acceptance criteria](docs/user-stories.md)
- [UI design brief](docs/ui-design-brief.md)
- [Database design](docs/database-design.md)
- [Delivery plan: PRs, story coverage, decision log](docs/project-plan.xlsx)
