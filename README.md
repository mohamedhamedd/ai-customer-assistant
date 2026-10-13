# AI Customer Assistant

An AI assistant that any small business can put in front of its customers. It answers questions, takes contact details and consultation requests, and works by **text or voice**.

**Stack:** Next.js · TypeScript · Supabase (Postgres + pgvector) · OpenAI

## What it does

**For customers** (`/b/<business>`)
- Answers questions about the business, with the source shown under each answer.
- Saves their contact details.
- Sends a consultation request for a service at a preferred time, and lets them change or cancel it while it's still pending.
- Asks the team to contact them about anything it can't do itself.
- Same assistant by voice, with the same tools and the same rules.

**For staff** (`/admin/<business>`)
- **Overview:** follow-ups to handle, recent requests and leads, and questions the assistant couldn't answer.
- **Consultations:** confirm or cancel requests, with filters, sorting and pages.
- **Leads** and **Conversations:** every customer and every transcript.
- **Services** and **Opening hours:** the business's exact facts.
- **Knowledge base:** upload documents (`.md`, `.txt`, text `.pdf`).
- **Settings:** name, description, timezone and the assistant's own rules.

## How it works

- **Two sources of facts.** The tables (services, prices, hours) are put in the prompt whole and quoted as written. Everything descriptive comes from the documents, which are searched. If the assistant doesn't find the answer, it says it doesn't know.
- **The model proposes, code decides.** The code checks every action before it's saved:
  - the service must be on the list, and the customer must have chosen it;
  - the time must be in the future and within opening hours;
  - nothing is saved until the customer says yes to a read-back.
- **Checks on every reply.** Prices and figures are checked against the sources, the assistant replies in English only, and it doesn't follow instructions found in what customers write.

## Getting started

You need Node.js 20+, Docker, and an OpenAI API key with access to the Realtime API (for voice).

```bash
npm install
cp .env.example .env.local
npm run db:start
npx supabase status
```

Copy the **API URL** and the **secret (service_role) key** into `.env.local`, and add your `OPENAI_API_KEY`. Then load the demo businesses and their documents:

```bash
npm run db:reset
npm run ingest -- ./data/sample-clinic
npm run ingest -- ./data/sample-salon --business maple-street-hair
npm run dev
```

Open:
- Chat: http://localhost:3000/b/lakeside-dental
- Admin: http://localhost:3000/admin/lakeside-dental

## Demo data

`npm run db:reset` wipes the local database and loads `supabase/seed.sql`: two businesses with their rules, services and opening hours. Customers, conversations and requests start empty. Load their documents after the reset:

```bash
npm run ingest -- ./data/sample-clinic
npm run ingest -- ./data/sample-salon --business maple-street-hair
```

| Business | Chat | Questions to try |
|---|---|---|
| Lakeside Dental Clinic | `/b/lakeside-dental` | `data/sample-clinic/README.md` |
| Maple Street Hair Studio | `/b/maple-street-hair` | `data/sample-salon/README.md` |

A third business, a gym, is in `data/sample-gym/`. It isn't seeded: create it in the admin (`/admin/new`) to show adding a business live.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the app on http://localhost:3000 |
| `npm run db:start` / `db:stop` | Start / stop the local database (Docker) |
| `npm run db:reset` | Wipe the local database and load the seed |
| `npm run ingest -- <folder>` | Upload a folder of documents (`--business <slug>`, `--replace`) |
| `npm test` | Unit tests |
| `npm run test:integration` | Tests against the local database |
| `npm run test:db` | Database tests (pgTAP) |
| `npm run lint` / `typecheck` | Code checks |
| `npm run db:types` | Regenerate the database types after a migration |

## Project structure

```
src/app/            pages and API routes (chat, voice, admin)
src/lib/agent/      prompt, tools and the agent loop
src/lib/chat/       one chat turn: checks, history, saving
src/lib/rag/        document upload, chunking, search
src/lib/admin/      admin data
supabase/           migrations, seed, database tests
data/               sample businesses
docs/               design documents
```

More detail: [docs/database-design.md](docs/database-design.md), [docs/DESIGN.md](docs/DESIGN.md).
