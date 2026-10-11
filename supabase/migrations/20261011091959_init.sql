-- Initial schema. Implements docs/database-design.md; section numbers below
-- refer to that document. Invariants (I1..I15) and queries (Q1..Q11) are
-- named there too.

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- Knowledge (§3.1 - §3.3)
-- ---------------------------------------------------------------------------

create table public.businesses (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  description text not null default '',
  timezone    text not null default 'America/Los_Angeles',
  created_at  timestamptz not null default now()
);

create table public.documents (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  title           text not null,
  source_type     text not null check (source_type in ('txt', 'md', 'pdf')),
  -- sha256 of the extracted text: re-uploading the same content is a no-op (I6).
  content_hash    text not null,
  -- Vectors from different models are not comparable (§3.2).
  embedding_model text not null,
  status          text not null default 'processing'
                  check (status in ('processing', 'ready', 'failed')),
  error           text,
  chunk_count     int not null default 0,
  created_at      timestamptz not null default now(),
  unique (business_id, content_hash)
);

-- I13: at most one live document per title, so a replace swap is atomic (§6.1).
create unique index documents_ready_title_idx
  on public.documents (business_id, lower(title))
  where status = 'ready';

create table public.chunks (
  id          bigint generated always as identity primary key,
  document_id uuid not null references public.documents(id) on delete cascade,
  -- Denormalised so vector search filters by tenant without a join (Q1).
  business_id uuid not null references public.businesses(id) on delete cascade,
  chunk_index int not null,
  heading     text not null default '',
  content     text not null,
  token_count int not null,
  embedding   extensions.vector(1536) not null,
  unique (document_id, chunk_index)
);

create index chunks_business_id_idx on public.chunks (business_id);
create index chunks_embedding_hnsw_idx on public.chunks
  using hnsw (embedding extensions.vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- Agent actions (§3.7 - §3.8). Leads come before conversations because
-- conversations reference them.
-- ---------------------------------------------------------------------------

create table public.leads (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  name           text not null,
  email          text constraint leads_email_lowercase check (email = lower(email)),  -- I3
  phone          text,
  interest       text,
  source_channel text not null check (source_channel in ('text', 'voice')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint leads_contact_required check (email is not null or phone is not null),  -- I1
  unique (business_id, email),                                 -- I2
  unique (business_id, phone)                                  -- I2
);

create index leads_business_created_idx on public.leads (business_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Conversation & memory (§3.4 - §3.6)
-- ---------------------------------------------------------------------------

create table public.conversations (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  session_id      uuid not null,
  -- For the admin (lead -> conversations). The agent never reads through it (§7).
  lead_id         uuid references public.leads(id) on delete set null,
  -- What the customer said in THIS conversation; the agent's only customer memory.
  customer_facts  jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  unique (business_id, session_id)                             -- I8
);

create index conversations_lead_id_idx on public.conversations (lead_id);
create index conversations_business_activity_idx
  on public.conversations (business_id, last_message_at desc);

create table public.messages (
  id                  bigint generated always as identity primary key,
  conversation_id     uuid not null references public.conversations(id) on delete cascade,
  -- Browser-generated per message, reused on retry (I14). Realtime item id for voice.
  client_message_id   text,
  -- Assistant rows only: the user message this answers. One reply per message (§7.1).
  reply_to_message_id bigint references public.messages(id) on delete cascade,
  role                text not null check (role in ('user', 'assistant')),
  channel             text not null default 'text' check (channel in ('text', 'voice')),
  -- Null only while a voice transcript is pending (§3.5).
  content             text constraint messages_content_not_empty check (content is null or content <> ''),
  sources             jsonb not null default '[]'::jsonb,
  -- clock_timestamp(), not now(): the admin transcript interleaves messages
  -- and tool_calls by time, and now() is the same for a whole transaction.
  created_at          timestamptz not null default clock_timestamp(),
  constraint messages_null_content_only_for_voice check (content is not null or channel = 'voice'),
  constraint messages_reply_only_from_assistant check (reply_to_message_id is null or role = 'assistant'),
  unique (conversation_id, client_message_id),
  unique (reply_to_message_id)
);

create index messages_conversation_id_idx on public.messages (conversation_id, id);

create table public.tool_calls (
  id              bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  channel         text not null check (channel in ('text', 'voice')),
  name            text not null,
  arguments       jsonb not null,
  result          jsonb not null,
  ok              boolean not null,
  duration_ms     int not null,
  created_at      timestamptz not null default clock_timestamp()
);

create index tool_calls_conversation_id_idx on public.tool_calls (conversation_id, id);

create table public.consultation_requests (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  lead_id         uuid not null references public.leads(id) on delete cascade,  -- I5
  conversation_id uuid references public.conversations(id) on delete set null,
  -- Snapshot of what the requester gave, so staff never call the wrong person (§3.8).
  contact_name    text not null,
  contact_email   text,
  contact_phone   text,
  service         text not null,
  preferred_at    timestamptz not null,
  notes           text,
  status          text not null default 'pending'
                  check (status in ('pending', 'confirmed', 'cancelled')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint consultation_requests_contact_required check (contact_email is not null or contact_phone is not null)
);

-- I4: keyed on the conversation, not the lead. Several people can be linked to
-- one lead, and a retry always comes from the same conversation.
create unique index consultation_requests_dedupe_idx
  on public.consultation_requests (conversation_id, lower(service), preferred_at);

create index consultation_requests_lead_id_idx on public.consultation_requests (lead_id);
create index consultation_requests_business_status_idx
  on public.consultation_requests (business_id, status, created_at desc);

-- ---------------------------------------------------------------------------
-- Triggers for derived timestamps (§3, conventions)
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

create trigger consultation_requests_set_updated_at
  before update on public.consultation_requests
  for each row execute function public.set_updated_at();

create or replace function public.touch_conversation()
returns trigger language plpgsql as $$
begin
  update public.conversations
     set last_message_at = new.created_at
   where id = new.conversation_id;
  return new;
end;
$$;

create trigger messages_touch_conversation
  after insert on public.messages
  for each row execute function public.touch_conversation();

-- ---------------------------------------------------------------------------
-- Retrieval (§5.1)
-- ---------------------------------------------------------------------------

-- similarity = 1 - cosine distance: 1.0 identical, ~0 unrelated.
create or replace function public.match_chunks(
  p_business_id     uuid,
  p_query_embedding extensions.vector(1536),
  p_match_count     int,
  p_min_similarity  float
)
returns table (
  chunk_id       bigint,
  document_id    uuid,
  document_title text,
  heading        text,
  content        text,
  similarity     float
)
language sql stable
-- HNSW applies the business_id filter after the index scan; iterative scans
-- keep going until enough rows survive the filter (pgvector >= 0.8).
set hnsw.iterative_scan = 'relaxed_order'
set search_path = public, extensions
as $$
  select c.id, c.document_id, d.title, c.heading, c.content, s.similarity
  from (
    select id, 1 - (embedding <=> p_query_embedding) as similarity
    from chunks
    where business_id = p_business_id
    order by embedding <=> p_query_embedding
    limit p_match_count
  ) s
  join chunks c on c.id = s.id
  join documents d on d.id = c.document_id
  where s.similarity >= p_min_similarity
  order by s.similarity desc;
$$;

-- ---------------------------------------------------------------------------
-- Security (§8): RLS on, no policies. Only the service role (server) can
-- read or write. The anon key gets nothing.
-- ---------------------------------------------------------------------------

alter table public.businesses            enable row level security;
alter table public.documents             enable row level security;
alter table public.chunks                enable row level security;
alter table public.leads                 enable row level security;
alter table public.conversations         enable row level security;
alter table public.messages              enable row level security;
alter table public.tool_calls            enable row level security;
alter table public.consultation_requests enable row level security;

revoke execute on function public.match_chunks from public, anon, authenticated;
revoke execute on function public.set_updated_at from public, anon, authenticated;
revoke execute on function public.touch_conversation from public, anon, authenticated;
