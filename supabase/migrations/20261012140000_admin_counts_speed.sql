-- Admin counts, cheaper (PR-11 review).

-- The status tabs and the sidebar badge only need the three status counts:
-- one pass over this business's requests (consultation_requests_business_status_idx),
-- instead of the whole admin_counts() with its 7-day message count.
create or replace function public.consultation_status_counts(p_business_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'pending',   count(*) filter (where status = 'pending'),
    'confirmed', count(*) filter (where status = 'confirmed'),
    'cancelled', count(*) filter (where status = 'cancelled')
  )
  from public.consultation_requests
  where business_id = p_business_id;
$$;

revoke execute on function public.consultation_status_counts(uuid) from public, anon, authenticated;

-- admin_counts() counts conversations with a message in the last 7 days.
-- Without this index that reads every message ever stored; with it, only
-- the window. (On a large live table, build it with CREATE INDEX
-- CONCURRENTLY outside a transaction to avoid blocking writes.)
create index messages_created_at_idx on public.messages (created_at);
