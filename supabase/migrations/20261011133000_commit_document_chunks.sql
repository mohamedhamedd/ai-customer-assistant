-- Atomic finish of an ingestion (design doc §6.1): insert every chunk, delete
-- the document this one replaces, and mark it ready, in one transaction.
-- A failure anywhere leaves zero chunks and the document still 'processing',
-- which the caller then marks 'failed'.
--
-- The status guard implements limitation L9: an ingestion that was declared
-- stale (and whose row was deleted or marked failed) cannot finish late and
-- resurrect itself.

create or replace function public.commit_document_chunks(
  p_document_id          uuid,
  p_chunks               jsonb,
  p_replaces_document_id uuid default null
)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_business_id uuid;
  v_count       int;
begin
  select business_id into v_business_id
    from public.documents
   where id = p_document_id and status = 'processing'
     for update;

  if v_business_id is null then
    raise exception 'document % is not in processing state', p_document_id
      using errcode = 'P0002';
  end if;

  -- Delete the old version first so the one-ready-title index (I13) is
  -- satisfied when this document becomes ready below.
  if p_replaces_document_id is not null then
    delete from public.documents
     where id = p_replaces_document_id and business_id = v_business_id;
  end if;

  insert into public.chunks
    (document_id, business_id, chunk_index, heading, content, token_count, embedding)
  select p_document_id, v_business_id,
         x.chunk_index, x.heading, x.content, x.token_count,
         x.embedding::text::extensions.vector
    from jsonb_to_recordset(p_chunks)
      as x(chunk_index int, heading text, content text, token_count int, embedding jsonb);

  get diagnostics v_count = row_count;

  update public.documents
     set status = 'ready', chunk_count = v_count, error = null
   where id = p_document_id;

  return v_count;
end;
$$;

revoke execute on function public.commit_document_chunks(uuid, jsonb, uuid)
  from public, anon, authenticated;
