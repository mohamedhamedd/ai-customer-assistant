-- Hybrid retrieval: vector similarity + Postgres full-text search, fused with
-- Reciprocal Rank Fusion (design doc §11, "Hybrid search").
--
-- Why: embeddings measure topical closeness, so an out-of-scope question
-- ("laser eye surgery") can score as high as a correct answer ("open Tuesday
-- afternoon?"). Keyword matching separates them: exact terms either occur in
-- the knowledge base or they don't. The retrieval service uses both signals
-- to decide whether anything was found.

-- Generated column: backfilled for existing rows, kept current automatically.
alter table public.chunks
  add column fts tsvector
  generated always as (to_tsvector('english', heading || ' ' || content)) stored;

create index chunks_fts_idx on public.chunks using gin (fts);

-- Builds an OR-query over the question's stemmed lexemes, so a single matching
-- topic word ("tuesday") counts. websearch_to_tsquery would AND every term and
-- miss most natural questions.
--
-- Question-frame verbs ("do you offer / provide / accept / have X") are always
-- dropped: they match FAQ headings like "Do you offer sedation?" without
-- saying anything about the topic. Domain actions (pay, open, take, call,
-- book, cancel) are kept on purpose: "How can I pay?" is a real question.
--
-- Of the rest, "specific" words are preferred: present in the corpus but not
-- in more than 25% of this business's chunks (IDF-style; never fewer than 3
-- chunks, so small knowledge bases keep their keywords). If nothing specific
-- remains but common words do ("What treatments do you have?"), that is a
-- broad question the corpus covers, so the common words are used instead,
-- but only when EVERY remaining word occurs in the corpus. "Do you have a
-- patient lounge?" mentions a common word, yet "lounge" is nowhere, so the
-- question is about something the business doesn't describe: no query.
-- Words absent from the corpus never form a query: "laser eye surgery".
--
-- Lexemes are already stemmed, so the query is built with a ::tsquery cast
-- rather than to_tsquery(), which would stem them a second time.
create or replace function public.keyword_query(p_business_id uuid, p_text text)
returns tsquery
language sql stable
set search_path = ''
as $$
  with lexemes as (
    select distinct l
      from unnest(tsvector_to_array(to_tsvector('english', coalesce(p_text, '')))) as l
     where l <> all (array['offer','provid','accept','do','have','get','sell','want','need',
                           'know','tell','give','make','use','see','help','like','look','find'])
  ),
  total as (
    select greatest(count(*), 1)::float as n from public.chunks where business_id = p_business_id
  ),
  df as (
    select l,
           (select count(*) from public.chunks c
             where c.business_id = p_business_id
               and c.fts @@ ('''' || replace(l, '''', '''''') || '''')::tsquery) as n
      from lexemes
  ),
  specific as (
    select l from df, total where df.n > 0 and df.n <= greatest(0.25 * total.n, 3)
  ),
  chosen as (
    select l from specific
    union all
    select l from df
     where df.n > 0
       and not exists (select 1 from specific)
       and not exists (select 1 from df absent where absent.n = 0)
  )
  select case
    when count(*) = 0 then null
    else string_agg('''' || replace(l, '''', '''''') || '''', ' | ')::tsquery
  end
  from chosen;
$$;

create or replace function public.hybrid_search(
  p_business_id     uuid,
  p_query_embedding extensions.vector(1536),
  p_query_text      text,
  p_match_count     int default 6,
  p_candidates      int default 20
)
returns table (
  chunk_id       bigint,
  document_id    uuid,
  document_title text,
  heading        text,
  content        text,
  similarity     float,
  keyword_rank   float,
  score          float
)
language sql stable
set hnsw.iterative_scan = 'relaxed_order'
set search_path = public, extensions
as $$
  with q as (
    select public.keyword_query(p_business_id, p_query_text) as tsq
  ),
  vec as (
    select id,
           1 - (embedding <=> p_query_embedding) as similarity,
           row_number() over (order by embedding <=> p_query_embedding) as rnk
      from chunks
     where business_id = p_business_id
     order by embedding <=> p_query_embedding
     limit least(greatest(coalesce(p_candidates, 20), 1), 40)
  ),
  kw as (
    select c.id,
           ts_rank_cd(c.fts, q.tsq) as keyword_rank,
           row_number() over (order by ts_rank_cd(c.fts, q.tsq) desc) as rnk
      from chunks c, q
     where c.business_id = p_business_id
       and q.tsq is not null
       and c.fts @@ q.tsq
     order by keyword_rank desc
     limit least(greatest(coalesce(p_candidates, 20), 1), 40)
  ),
  fused as (
    -- RRF with the conventional k = 60: rank positions matter, raw scores don't.
    select coalesce(vec.id, kw.id) as id,
           vec.similarity,
           kw.keyword_rank,
           coalesce(1.0 / (60 + vec.rnk), 0) + coalesce(1.0 / (60 + kw.rnk), 0) as score
      from vec
      full outer join kw on kw.id = vec.id
  )
  select c.id, c.document_id, d.title, c.heading, c.content,
         -- A keyword-only candidate still gets its real similarity.
         coalesce(f.similarity, 1 - (c.embedding <=> p_query_embedding)) as similarity,
         coalesce(f.keyword_rank, 0) as keyword_rank,
         f.score
    from fused f
    join chunks c on c.id = f.id
    join documents d on d.id = c.document_id
   where coalesce(f.similarity, 1 - (c.embedding <=> p_query_embedding)) <> 'NaN'::float
   order by f.score desc, similarity desc
   limit least(greatest(coalesce(p_match_count, 6), 0), 40);
$$;

revoke execute on function public.keyword_query(uuid, text) from public, anon, authenticated;
revoke execute on function public.hybrid_search(uuid, extensions.vector, text, int, int)
  from public, anon, authenticated;
