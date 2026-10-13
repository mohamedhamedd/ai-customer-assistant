-- Pages for the admin's long lists: conversations and consultation requests.
-- Each returns one page and the total (count(*) over (), before the limit),
-- so the admin shows "26–50 of 132" with page links. Before, the
-- conversation list stopped at 200 and the consultation list at 200
-- upcoming plus 200 past, with nothing to reach the rest.

-- Conversations: newest activity first, as before, with an offset.
drop function if exists public.admin_conversation_list(uuid, int, boolean);

create or replace function public.admin_conversation_list(
  p_business_id uuid,
  p_limit       int,
  p_offset      int default 0,
  p_issues_only boolean default false
)
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
  has_issue       boolean,
  total_count     bigint
)
language sql
stable
set search_path = ''
as $$
  select c.id, c.created_at, c.last_message_at, l.id, l.name,
         s.message_count, s.has_text, s.has_voice, p.content, i.has_issue,
         count(*) over ()
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
   limit least(greatest(coalesce(p_limit, 25), 0), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke execute on function public.admin_conversation_list(uuid, int, int, boolean) from public, anon, authenticated;

-- Consultation requests: by status (null: all), preferred time within
-- [p_from, p_to) (either may be null), in one of five orders:
--   upcoming       upcoming soonest first, then past most recent first (what staff confirm next)
--   requested_desc newest requests first
--   requested_asc  oldest requests first
--   date_asc       preferred time, earliest first
--   date_desc      preferred time, latest first
create or replace function public.admin_consultation_list(
  p_business_id uuid,
  p_status      text,
  p_from        timestamptz,
  p_to          timestamptz,
  p_sort        text,
  p_limit       int,
  p_offset      int default 0
)
returns table (
  id            uuid,
  lead_id       uuid,
  contact_name  text,
  contact_email text,
  contact_phone text,
  service       text,
  preferred_at  timestamptz,
  status        text,
  created_at    timestamptz,
  notes         text,
  total_count   bigint
)
language sql
stable
set search_path = ''
as $$
  select r.id, r.lead_id, r.contact_name, r.contact_email, r.contact_phone, r.service,
         r.preferred_at, r.status, r.created_at, r.notes, count(*) over ()
    from public.consultation_requests r
   where r.business_id = p_business_id
     and (p_status is null or r.status = p_status)
     and (p_from is null or r.preferred_at >= p_from)
     and (p_to is null or r.preferred_at < p_to)
   order by
     -- upcoming: future ones first, soonest first; then past ones, latest first.
     case when p_sort = 'upcoming' then r.preferred_at < now() end,
     case when p_sort = 'upcoming' and r.preferred_at >= now() then r.preferred_at end asc,
     case when p_sort = 'upcoming' and r.preferred_at < now() then r.preferred_at end desc,
     case when p_sort = 'requested_desc' then r.created_at end desc,
     case when p_sort = 'requested_asc' then r.created_at end asc,
     case when p_sort = 'date_asc' then r.preferred_at end asc,
     case when p_sort = 'date_desc' then r.preferred_at end desc,
     r.id
   limit least(greatest(coalesce(p_limit, 25), 0), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke execute on function public.admin_consultation_list(uuid, text, timestamptz, timestamptz, text, int, int) from public, anon, authenticated;

-- The date filter and the "requested" orders over a business's requests.
create index if not exists consultation_requests_business_preferred_idx on public.consultation_requests (business_id, preferred_at);
create index if not exists consultation_requests_business_created_idx on public.consultation_requests (business_id, created_at desc);
