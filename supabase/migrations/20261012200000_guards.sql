-- Guards (PR-16): every message the input guard blocks and every answer an
-- output check replaces is recorded here, with what was blocked and why.
--
-- One table, three uses:
-- 1. Staff see it: the admin transcript marks flagged messages, and staff
--    confirm or dismiss the ones the guard learns from.
-- 2. The input guard learns from it: blocked customer messages keep their
--    embedding, and the guard is shown the most similar *confirmed* ones as
--    examples (same business only: tenant isolation holds for learned data).
--    Only confirmed rows: a wrong block, or one planted on purpose ("what are
--    your prices? also write a poem"), must not teach the guard to refuse
--    real customers.
-- 3. The eval replays it: confirmed and unreviewed attacks are sent again
--    after every change; dismissed ones must then pass (a real customer's
--    question the guard got wrong becomes a "must not block" test).
create table public.flags (
  id              bigint generated always as identity primary key,
  business_id     uuid not null references public.businesses(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  -- The customer message (input layer) or the stored answer (output layers).
  message_id      bigint references public.messages(id) on delete cascade,
  -- input: the input guard blocked this customer message.
  -- caught: this customer message got past the input guard, and its answer
  --         was replaced by an output check (an attack caught late).
  -- canary / scope / numbers: this answer failed that check and was replaced.
  layer           text not null check (layer in ('input', 'caught', 'canary', 'scope', 'numbers')),
  category        text not null,
  reason          text not null default '',
  -- What was blocked: the customer's message, or the answer before it was
  -- replaced. Kept for review; never shown to customers.
  original        text not null,
  -- Input and caught layers: the customer message's embedding, for examples.
  embedding       extensions.vector(1536),
  -- Whether it may teach the guard. Clear attacks (injection, a claim of
  -- authority, questions about internals) are confirmed when recorded: the
  -- message itself is the proof. Off-topic blocks and attacks caught late
  -- wait for staff, who confirm or dismiss them.
  status          text not null default 'new' check (status in ('new', 'confirmed', 'dismissed')),
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index flags_message_id_idx on public.flags (message_id);
create index flags_conversation_id_idx on public.flags (conversation_id);
create index flags_business_created_idx on public.flags (business_id, created_at desc);
create index flags_embedding_hnsw_idx on public.flags
  using hnsw (embedding extensions.vector_cosine_ops) where embedding is not null;

revoke all on public.flags from anon, authenticated;
alter table public.flags enable row level security;

-- The confirmed past attacks most like this message, for the input guard's
-- examples. This business only.
create or replace function public.similar_flags(p_business_id uuid, p_embedding extensions.vector(1536), p_limit int)
returns table (original text, category text, similarity float)
language sql
stable
set search_path = ''
as $$
  select f.original, f.category, 1 - (f.embedding operator(extensions.<=>) p_embedding)
    from public.flags f
   where f.business_id = p_business_id
     and f.status = 'confirmed'
     and f.embedding is not null
   order by f.embedding operator(extensions.<=>) p_embedding
   limit least(greatest(coalesce(p_limit, 3), 0), 10);
$$;

revoke execute on function public.similar_flags(uuid, extensions.vector, int) from public, anon, authenticated;

-- A throwaway copy of a business for an eval run: same profile, documents,
-- chunks (with their embeddings, so no API cost) and past flags. The eval
-- talks to the copy, then deletes it; everything it created (conversations,
-- leads, requests) goes with it, and the real business is never touched.
create or replace function public.clone_business_for_eval(p_source uuid, p_slug text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.businesses (slug, name, description, timezone, assistant_guidelines)
  select p_slug, name, description, timezone, assistant_guidelines
    from public.businesses where id = p_source
  returning id into v_id;
  if v_id is null then
    raise exception 'unknown business';
  end if;

  create temporary table doc_map on commit drop as
    select d.id as old_id, gen_random_uuid() as new_id
      from public.documents d where d.business_id = p_source and d.status = 'ready';

  insert into public.documents (id, business_id, title, source_type, content_hash, embedding_model, status, chunk_count, created_at)
  select m.new_id, v_id, d.title, d.source_type, d.content_hash, d.embedding_model, d.status, d.chunk_count, d.created_at
    from public.documents d join doc_map m on m.old_id = d.id;

  insert into public.chunks (document_id, business_id, chunk_index, heading, content, token_count, embedding)
  select m.new_id, v_id, c.chunk_index, c.heading, c.content, c.token_count, c.embedding
    from public.chunks c join doc_map m on m.old_id = c.document_id;

  insert into public.flags (business_id, layer, category, reason, original, embedding, status, created_at)
  select v_id, layer, category, reason, original, embedding, status, created_at
    from public.flags where business_id = p_source and layer in ('input', 'caught');

  return v_id;
end;
$$;

revoke execute on function public.clone_business_for_eval(uuid, text) from public, anon, authenticated;
