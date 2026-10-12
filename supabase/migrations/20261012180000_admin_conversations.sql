-- Conversation review (PR-12, US-9.1 and US-9.3).

-- The conversations list in one query: newest activity first, each with its
-- message count, the channels it used, its lead and its last message.
-- Conversations nobody wrote in (opened, then left) are not listed.
--
-- The per-row work is two lookups on messages_conversation_id_idx
-- (conversation_id, id), and the list is walked in
-- conversations_business_activity_idx order, so it stops after p_limit rows.
create or replace function public.admin_conversations(p_business_id uuid, p_limit int)
returns table (
  id              uuid,
  started_at      timestamptz,
  last_message_at timestamptz,
  lead_id         uuid,
  lead_name       text,
  message_count   bigint,
  has_text        boolean,
  has_voice       boolean,
  preview         text
)
language sql
stable
set search_path = ''
as $$
  select c.id, c.created_at, c.last_message_at, l.id, l.name,
         s.message_count, s.has_text, s.has_voice, p.content
    from public.conversations c
    left join public.leads l on l.id = c.lead_id
   cross join lateral (
     select count(*)                       as message_count,
            coalesce(bool_or(m.channel = 'text'), false)  as has_text,
            coalesce(bool_or(m.channel = 'voice'), false) as has_voice
       from public.messages m
      where m.conversation_id = c.id
   ) s
    left join lateral (
     -- A voice item with no transcript (a cough) has no text to preview.
     select m.content
       from public.messages m
      where m.conversation_id = c.id and m.content is not null
      order by m.id desc
      limit 1
   ) p on true
   where c.business_id = p_business_id
     and s.message_count > 0
   order by c.last_message_at desc, c.id
   -- NULL would mean no limit and a negative value is an error; clamp both.
   limit least(greatest(coalesce(p_limit, 50), 0), 200);
$$;

revoke execute on function public.admin_conversations(uuid, int) from public, anon, authenticated;

-- Searches that found nothing (US-9.3): the questions the documents don't
-- cover. A partial index, so listing the newest ones reads only those rows,
-- not every tool call.
create index tool_calls_knowledge_gaps_idx
  on public.tool_calls (created_at desc)
  where name = 'search_knowledge' and (result ->> 'found') = 'false';
