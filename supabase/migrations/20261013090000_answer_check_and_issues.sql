-- Simpler guards, step 1 of 2 (adds only; the next migration removes the
-- flags table). Split so a server still running the previous code keeps
-- working until it is updated.
--
-- The guards are now one answer check in plain code: a text answer that
-- leaks the system prompt, or names a price, percentage or phone number
-- found nowhere the assistant could know it from, is replaced by a safe
-- reply. What the model wrote and why it was replaced stay on the message,
-- for staff only (the transcript and the issues list), never for customers.
alter table public.messages
  add column replaced_original text,
  add column replaced_reason   text,
  add constraint messages_replaced_together check ((replaced_original is null) = (replaced_reason is null)),
  add constraint messages_replaced_only_answers check (replaced_reason is null or role = 'assistant');

-- The issues list: answers the check replaced, and tool calls that failed
-- (the database was down, or a write's outcome is unknown). Both are rare,
-- so partial indexes keep finding them cheap.
create index messages_replaced_idx on public.messages (conversation_id, created_at desc)
  where replaced_reason is not null;
create index tool_calls_failed_idx on public.tool_calls (conversation_id, created_at desc)
  where (result ->> 'error') in ('temporarily_unavailable', 'outcome_unknown');

-- The conversations list (as admin_conversations, PR-12), with has_issue
-- and an issues-only filter. A new name: the old function stays until the
-- next migration, for a server still running the previous code.
create or replace function public.admin_conversation_list(p_business_id uuid, p_limit int, p_issues_only boolean default false)
returns table (
  id              uuid,
  started_at      timestamptz,
  last_message_at timestamptz,
  lead_id         uuid,
  lead_name       text,
  message_count   bigint,
  has_text        boolean,
  has_voice       boolean,
  preview         text,
  has_issue       boolean
)
language sql
stable
set search_path = ''
as $$
  select c.id, c.created_at, c.last_message_at, l.id, l.name,
         s.message_count, s.has_text, s.has_voice, p.content, i.has_issue
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
   cross join lateral (
     select exists (select 1 from public.messages m where m.conversation_id = c.id and m.replaced_reason is not null)
         or exists (select 1 from public.tool_calls t where t.conversation_id = c.id
                       and (t.result ->> 'error') in ('temporarily_unavailable', 'outcome_unknown'))
            as has_issue
   ) i
   where c.business_id = p_business_id
     and s.message_count > 0
     and (not coalesce(p_issues_only, false) or i.has_issue)
   order by c.last_message_at desc, c.id
   -- NULL would mean no limit and a negative value is an error; clamp both.
   limit least(greatest(coalesce(p_limit, 50), 0), 200);
$$;

revoke execute on function public.admin_conversation_list(uuid, int, boolean) from public, anon, authenticated;
