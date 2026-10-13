-- Follow-ups: what a customer asked the team to contact them about, when
-- the assistant can't do it itself (a confirmed request to change, a
-- question it couldn't answer). Before, only the contact was saved, and an
-- existing lead is never overwritten, so the reason lived only in the
-- conversation. Staff see open follow-ups in the admin and mark them done.
create table public.follow_ups (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  lead_id         uuid not null references public.leads(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  -- In the customer's terms: "Cancel the Invisalign consultation on Wednesday, October 14 at 3:00 PM".
  reason          text not null check (char_length(btrim(reason)) between 1 and 300),
  status          text not null default 'open' check (status in ('open', 'done')),
  created_at      timestamptz not null default now(),
  done_at         timestamptz,
  check ((status = 'done') = (done_at is not null))
);

-- One open follow-up per conversation: asking again updates what it's about.
create unique index follow_ups_open_per_conversation_idx on public.follow_ups (conversation_id) where status = 'open';
create index follow_ups_business_status_idx on public.follow_ups (business_id, status, created_at desc);
create index follow_ups_lead_idx on public.follow_ups (lead_id);

revoke all on public.follow_ups from anon, authenticated;
alter table public.follow_ups enable row level security;

-- The agent's request_follow_up: the customer's contact must be saved on the
-- conversation (lead_required otherwise), like a consultation request.
create or replace function public.request_follow_up(p_business_id uuid, p_conversation_id uuid, p_reason text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_conv    public.conversations%rowtype;
  v_id      uuid;
  v_created boolean;
begin
  select * into v_conv from public.conversations where id = p_conversation_id and business_id = p_business_id;
  if v_conv.id is null then
    raise exception 'conversation % not found', p_conversation_id using errcode = 'P0002';
  end if;
  if v_conv.lead_id is null then
    raise exception 'lead_required' using errcode = 'P0001';
  end if;

  insert into public.follow_ups (business_id, lead_id, conversation_id, reason)
  values (p_business_id, v_conv.lead_id, p_conversation_id, btrim(p_reason))
  on conflict (conversation_id) where status = 'open'
  do update set reason = excluded.reason
  returning id, (xmax = 0) into v_id, v_created;

  return jsonb_build_object('follow_up_id', v_id, 'created', v_created);
end;
$$;

revoke execute on function public.request_follow_up(uuid, uuid, text) from public, anon, authenticated;
