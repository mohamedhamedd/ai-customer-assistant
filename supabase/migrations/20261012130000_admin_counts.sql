-- Every number the admin shows, in one query (PR-11 review): the request
-- counts per status (the tabs and the sidebar badge) and the overview KPIs.
--
-- "Conversations" counts conversations with a message in the window, so a
-- returning visitor's conversation (created weeks ago, active this week)
-- counts; "leads" counts leads captured in the window.
create or replace function public.admin_counts(p_business_id uuid, p_since timestamptz)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'pending',   (select count(*) from public.consultation_requests where business_id = p_business_id and status = 'pending'),
    'confirmed', (select count(*) from public.consultation_requests where business_id = p_business_id and status = 'confirmed'),
    'cancelled', (select count(*) from public.consultation_requests where business_id = p_business_id and status = 'cancelled'),
    'active_conversations', (
      select count(distinct m.conversation_id)
        from public.messages m
        join public.conversations c on c.id = m.conversation_id
       where c.business_id = p_business_id and m.created_at >= p_since
    ),
    'new_leads',       (select count(*) from public.leads where business_id = p_business_id and created_at >= p_since),
    'documents_ready', (select count(*) from public.documents where business_id = p_business_id and status = 'ready'),
    'documents_total', (select count(*) from public.documents where business_id = p_business_id)
  );
$$;

revoke execute on function public.admin_counts(uuid, timestamptz) from public, anon, authenticated;
