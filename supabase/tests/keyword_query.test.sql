-- Tests for keyword_query(), the topic-keyword half of the retrieval found
-- rule. Self-contained: builds two throwaway businesses inside a transaction
-- that is rolled back. Run with `npm run test:db` (pgTAP via the Supabase CLI).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(8);

-- The sorted lexemes of a tsquery, or NULL. string_agg order isn't
-- guaranteed, so tests compare sets.
create function pg_temp.lexemes(q tsquery) returns text[] language sql as $$
  select array_agg(m[1] order by m[1]) from regexp_matches(q::text, $re$'([^']+)'$re$, 'g') as m
$$;

-- A tiny knowledge base: 3 chunks. Every word is in at least 33% of them.
insert into businesses (id, slug, name) values ('00000000-0000-0000-0000-00000000aa01', 'test-tiny', 'Tiny');
insert into documents (id, business_id, title, source_type, content_hash, embedding_model, status)
values ('00000000-0000-0000-0000-00000000dd01', '00000000-0000-0000-0000-00000000aa01', 'FAQ', 'md', 'tiny', 'm', 'ready');
insert into chunks (document_id, business_id, chunk_index, heading, content, token_count, embedding)
select '00000000-0000-0000-0000-00000000dd01', '00000000-0000-0000-0000-00000000aa01', g, 'FAQ',
       (array['We are open on Tuesday until 5pm.', 'Parking is free behind the building.', 'Call us on 555-0142.'])[g + 1],
       8, array_fill(0.1, array[1536])::vector
  from generate_series(0, 2) g;

-- A larger one: 8 chunks, "treatment" in 4 of them (common: > 25% and > 3),
-- "patient" in 4, "tuesday" in 1 (specific).
insert into businesses (id, slug, name) values ('00000000-0000-0000-0000-00000000aa02', 'test-clinic', 'Clinic');
insert into documents (id, business_id, title, source_type, content_hash, embedding_model, status)
values ('00000000-0000-0000-0000-00000000dd02', '00000000-0000-0000-0000-00000000aa02', 'Guide', 'md', 'clinic', 'm', 'ready');
insert into chunks (document_id, business_id, chunk_index, heading, content, token_count, embedding)
select '00000000-0000-0000-0000-00000000dd02', '00000000-0000-0000-0000-00000000aa02', g, 'Guide',
       (array['Whitening treatment for every patient.', 'Crown treatment takes two visits for a patient.',
              'Braces treatment for children and each patient.', 'Root canal treatment saves a patient tooth.',
              'We are open on Tuesday.', 'Parking is free.', 'Call the front desk.', 'Bring your insurance card.'])[g + 1],
       8, array_fill(0.1, array[1536])::vector
  from generate_series(0, 7) g;

select is(pg_temp.lexemes(keyword_query('00000000-0000-0000-0000-00000000aa01', 'Are you open on Tuesday?')),
          array['open', 'tuesday'],
          'tiny knowledge base: words in 1 of 3 chunks are still specific (floor of 3 chunks)');

select is(pg_temp.lexemes(keyword_query('00000000-0000-0000-0000-00000000aa02', 'Are you open on Tuesday for treatment?')),
          array['open', 'tuesday'],
          'specific words win; the common word is left out');

select is(pg_temp.lexemes(keyword_query('00000000-0000-0000-0000-00000000aa02', 'What treatments do you have?')),
          array['treatment'],
          'broad question of only common words falls back to them');

select is(keyword_query('00000000-0000-0000-0000-00000000aa02', 'Do you have a patient lounge?'),
          null,
          'common word plus an absent word: no fallback, the topic is not covered');

select is(keyword_query('00000000-0000-0000-0000-00000000aa02', 'Do you offer laser eye surgery?'),
          null,
          'only absent words: no query');

select is(keyword_query('00000000-0000-0000-0000-00000000aa02', 'Do you offer or provide anything?'),
          null,
          'question-frame verbs never count as keywords');

select is(keyword_query('00000000-0000-0000-0000-00000000aa02', ''),
          null,
          'empty text: no query');

select ok(not has_function_privilege('anon', 'public.keyword_query(uuid, text)', 'execute'),
          'anon cannot execute keyword_query');

select * from finish();
rollback;
