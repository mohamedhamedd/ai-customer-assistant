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
