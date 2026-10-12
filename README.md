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

`POST /api/chat` with `{ businessSlug, sessionId, clientMessageId, message }` streams the reply as NDJSON (one JSON event per line): `start`, `delta` (text), `tool` (started/finished), `action` (lead saved, consultation requested, failed), `sources`, `done`, or `error`. `GET /api/chat?business=…&sessionId=…` returns the conversation history. An unknown business is a 404, and a browser session gets a separate conversation with each business.

- **Memory:** the browser sends only the new message. The server loads the last 20 messages, what the customer told us (`customer_facts`) and what was already done in the conversation (contact saved, requests with their live status). A client can't inject fake history.
- **Agent loop** (`src/lib/agent/loop.ts`): hand-written over Chat Completions. Model → tool calls (run in order) → results back → repeat, at most 5 tool rounds, then one call with tools off so it must answer. The whole turn has a 45 s deadline, and a tool is only started if its 15 s timeout fits in what's left.
- **One turn at a time:** a second message while the first is still being answered gets 409, enforced in the database with a row lock on the conversation.
- **Retries:** each message carries a `clientMessageId`. Resending it replays a stored reply (no model call), returns 409 while the original is still running, or re-runs it if the original failed or died.
- **Failures:** if the model call fails, the customer gets a friendly message, the message stays saved and is marked failed, and one structured log line records the reason.

## Customer chat

`/b/[slug]` is the chat for one business (`/` opens the demo business until the home page lands). The name comes from the database, so the same page serves any business. Code: `src/components/chat/`.

- **`thread.ts`**: the thread as plain data and every rule that changes it, unit-tested without a browser. A retryable error drops partially streamed text (the server never saves it), so the screen matches what a reload shows; only the **latest** failed message offers Retry (an older one's answer would land out of order); a repeated "details saved" card is shown once.
- **`use-chat.ts`**: the network side. An anonymous session id in `localStorage` (one per business), a fresh `clientMessageId` per message (reused on retry, also after a reload), NDJSON streaming, 409 / offline / "AI unavailable" handling, and re-sending a message that failed while offline when the browser is back online.
- **UI**: streaming markdown (tables, lists; raw HTML is ignored), a tool status line ("Searching {business} information…"), source chips with the passage in a popover (a bottom sheet on mobile), action cards built from tool results (never from the model's text), and a consultation card that always says *Pending*, with the time in the business's timezone. Composer: Enter sends, Shift+Enter adds a line, counter from 1,800 characters, limit 2,000. Works from 360 px wide, by keyboard, and in dark mode; screen readers hear each finished answer once instead of every streamed fragment.

## Voice

Voice uses the OpenAI Realtime API over WebRTC: audio goes straight between the browser and OpenAI, with server-side turn detection (natural pauses, and talking over the assistant interrupts it). Code: `src/lib/voice/`, `src/app/api/voice/`, `src/components/chat/use-voice.ts`.

- **No key or token in the browser.** The browser sends its WebRTC offer to `POST /api/voice/session`; the server opens the call with the session config (same prompt with a spoken style, same three tools, the conversation so far) and returns OpenAI's answer plus a **secret for this call**. The server stores only its hash, with a 70-minute expiry; every tool relay and transcript report must carry it, so the voice endpoints only work for a live call and only for its own conversation.
- **One tool layer.** The model's tool calls arrive in the browser, which relays them to `POST /api/voice/tool`; the server runs them with its own business and conversation context, through the same executor, validation and SQL functions as text chat.
- **One conversation.** Transcripts are stored as `channel = 'voice'` messages in the same conversation (`POST /api/voice/items`, reported when an item starts and again when its transcript is ready, so the order is right). Typing after a call continues with the voice context, and vice versa.
- **Cards and citations come from the server.** The browser says which tool calls an answer used (by the model's call ids); the server reads their results from its own audit log, limited to this call and attached to one answer only, so the browser can't forge or reuse a card.
- **Interruptions:** when the customer talks over an answer, the caption and the stored transcript keep roughly what was heard (from how much audio played), marked "(interrupted)", so later turns don't assume the customer heard the rest. A brief network drop doesn't end the call; only a failed connection, or one down for 5 seconds, does.
- **UI:** a permission explainer, a compact panel with an orb that follows the audio level, Listening / Thinking / Checking / Speaking / Muted states, Mute, End, and clear states for a blocked microphone or a dropped connection. Captions appear live in the thread with mic and speaker icons.

Known limits: the browser reports transcripts, so a visitor with a live call could write fake lines into their own transcript, and could call the tools directly while their call lasts (no more than they could by speaking; never into another conversation; design doc L1). A visitor could also send `session.update` on their own call. A server-side connection to the call is the production fix for all three. "What was heard" is estimated from a typical speaking rate. Opening calls isn't rate-limited and calls have no hard time limit yet (PR-13).

## Admin: knowledge base

The knowledge base of a business is at `/admin/[slug]/knowledge-base` (the business is in the URL, ready for the switcher in PR-15). Code: `src/components/admin/`, `src/lib/admin/`, `src/app/api/admin/[slug]/`.

- **Upload** by drag and drop or the file picker: `.txt`, `.md` and text-based `.pdf`, up to 10 MB each, several at once. The browser refuses a wrong type, an empty file or an oversized one before uploading (the server checks again, with the same rules from `src/lib/rag/file-types.ts`), and the server stops reading any request body past the cap, with or without a `Content-Length`.
- **Replace:** a new file with an existing document's title (an updated price list) is caught before anything is embedded, and the row offers *Replace*: the new version takes the old one's place in one transaction. Each file shows *Uploading… n%* → *Processing* → *Ready · n sections*, *Already in your knowledge base* (same content, detected by hash), or *Failed* with the reason (e.g. a scanned PDF).
- **Ingestion is synchronous**, through the same pipeline as `npm run ingest`: the request returns when the document is ready or failed, a few seconds per file. Files are sent one at a time. For large volumes the next step is a job queue.
- **Documents table** with search, a section preview (how the document was split, US-7.4) and delete with confirmation. Deleting removes the chunks, so the assistant stops using it at once; answers already given keep their citation snapshots.
- **Test search** runs the assistant's own search function (same result count, same query handling) and "found" rule for a question, and says whether the assistant would answer or say it doesn't know (US-7.5).
- Every admin query is scoped to the business in the URL: another business's document id is "not found".
- Failed documents show a plain reason (a scanned PDF, an interrupted upload); internal error details stay in the server log. An upload that died mid-way (server restart) shows as interrupted after 10 minutes instead of "Processing" forever.

## Admin: overview, leads and consultations

**Sign-in.** Set `ADMIN_PASSWORD` (at least 8 characters) in `.env.local` and the admin asks for it once; the server then keeps you signed in with a signed, httpOnly, SameSite=Lax cookie (12 hours). Without it, the admin is open under `npm run dev` (labelled "Demo mode · no login") and **locked** in a production build, so a deploy can't go out with customer data open. Every admin page and every `/api/admin/*` route checks the session.

`/admin` opens on the **Overview**: conversations active and leads captured in the last 7 days, pending consultations, documents ready, and the latest requests and leads (contact details masked, as it's the screen most likely to be shared).

- **Leads** (`/admin/[slug]/leads`): newest first, searchable by name or email (`%` and `_` are matched literally). A lead opens a drawer with its contact details (copy buttons), interest and consultation requests.
- **Consultations** (`/admin/[slug]/consultations`): Pending by default, then Confirmed / Cancelled / All. Upcoming requests first (soonest first), then past ones (most recent first), each part capped, so history never pushes next week off the list. The contact shown is the snapshot taken with the request. Status changes apply at once (optimistic) with a toast; the row's menu is locked while it saves, and if the save fails the row goes back and the toast says why. Reopening a cancelled request whose time slot was requested again is refused (one active request per slot).
- **Times** are stored in UTC and always shown in the business's timezone, each with its own zone label ("3:00 PM PDT", and "PST" after the clock change), so staff and customer mean the same 3:00 PM.
- **Counts** (tabs, sidebar badge, overview) come from one SQL function, `admin_counts()`.
- Lists are capped at 200 rows; past that, the next step is cursor pagination. Every query is scoped to the business in the URL.

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
  app/            Next.js routes: customer chat (/b/[slug]), admin, API route handlers
  components/chat/  Customer chat UI and voice mode (client components)
  lib/
    env.ts        Validated configuration (server-only)
    openai.ts     OpenAI client (server-only)
    db/           Supabase service-role client + data access (server-only)
    rag/          Document extraction, chunking, embeddings, retrieval
    agent/        System prompt, tool definitions, agent loop
    voice/        Realtime session config, call setup, tool relay, transcripts
  instrumentation.ts  Fails fast at boot on bad configuration
supabase/         Local Supabase config, migrations, seed
data/sample-clinic/  Demo business documents and the demo question/answer map
scripts/          CLI scripts (document ingestion, retrieval eval)
docs/             User stories, UI design brief, delivery plan
```

## Security model

- The browser never talks to Supabase or OpenAI with a secret. All database access goes through server route handlers using the service-role key.
- Every module that touches a secret imports `server-only`, so importing it from client code fails the build.
- The admin is behind one shared password (`ADMIN_PASSWORD`, signed session cookie), and locked in production when it isn't set. Production next step: per-user accounts (e.g. Supabase Auth) with a membership check per business, and rate-limited sign-in (PR-13).

## Planning docs

- [User stories & acceptance criteria](docs/user-stories.md)
- [UI design brief](docs/ui-design-brief.md)
- [Database design](docs/database-design.md)
- [Delivery plan: PRs, story coverage, decision log](docs/project-plan.xlsx)
