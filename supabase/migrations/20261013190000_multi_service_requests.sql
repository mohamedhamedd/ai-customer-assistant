-- One consultation request is one visit: one time, one or more services
-- ("a cut and colour on Saturday at 10").
--
-- Before, a request had one service, and the slot (conversation, time) is a
-- request's identity (consultation_dedupe_by_slot). So the colour after the
-- cut found the cut's slot taken and came back as "already requested" for
-- the cut: a second service at the same time was lost.
--
-- services holds the list; service stays, as a label computed from it
-- ("Women's cut and style, Full colour"), so everything that shows a request
-- (the admin, the overview, transcripts, the prompt) reads it as before.

-- The label: the names, in order, separated by commas. Immutable, as a
-- generated column needs.
create or replace function public.services_label(p_services text[])
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(array_to_string(p_services, ', '), '');
$$;

-- A valid list: one to five names, none blank or over 120 characters, none
-- repeated (ignoring case).
create or replace function public.services_valid(p_services text[])
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select cardinality(p_services) between 1 and 5
     and array_position(p_services, null) is null
     and (select bool_and(char_length(btrim(s)) between 1 and 120)
               and count(distinct lower(btrim(s))) = count(*)
            from unnest(p_services) s);
$$;

alter table public.consultation_requests add column services text[];
update public.consultation_requests set services = array[service];
alter table public.consultation_requests
  alter column services set not null,
  add constraint consultation_requests_services_check check (public.services_valid(services));

alter table public.consultation_requests drop column service;
alter table public.consultation_requests
  add column service text generated always as (public.services_label(services)) stored;

-- The agent's create_consultation_request, with a list. A repeat (same
-- conversation and time) returns the request already there, with its
-- services: the tool tells a retry from a different visit at that time.
drop function public.create_consultation_request(uuid, uuid, text, timestamptz, text);

create function public.create_consultation_request(
  p_business_id     uuid,
  p_conversation_id uuid,
  p_services        text[],
  p_preferred_at    timestamptz,
  p_notes           text default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_conv     public.conversations%rowtype;
  v_id       uuid;
  v_status   text;
  v_services text[];
  v_created  boolean := true;
begin
  select * into v_conv from public.conversations
   where id = p_conversation_id and business_id = p_business_id;
  if v_conv.id is null then
    raise exception 'conversation % not found', p_conversation_id using errcode = 'P0002';
  end if;
  if v_conv.lead_id is null then
    raise exception 'lead_required' using errcode = 'P0001',
      hint = 'Save the customer''s contact details with save_lead first.';
  end if;

  insert into public.consultation_requests
    (business_id, lead_id, conversation_id, contact_name, contact_email, contact_phone,
     services, preferred_at, notes)
  values
    (p_business_id, v_conv.lead_id, p_conversation_id,
     v_conv.customer_facts->>'name', v_conv.customer_facts->>'email', v_conv.customer_facts->>'phone',
     p_services, p_preferred_at, p_notes)
  on conflict (conversation_id, preferred_at) where status <> 'cancelled' do nothing
  returning id, status, services into v_id, v_status, v_services;

  if v_id is null then
    v_created := false;
    select id, status, services into v_id, v_status, v_services
      from public.consultation_requests
     where conversation_id = p_conversation_id
       and preferred_at = p_preferred_at
       and status <> 'cancelled';
  end if;

  return jsonb_build_object('request_id', v_id, 'status', v_status, 'services', to_jsonb(v_services),
                            'service', public.services_label(v_services), 'created', v_created);
end;
$$;

revoke execute on function public.create_consultation_request(uuid, uuid, text[], timestamptz, text)
  from public, anon, authenticated;

-- The agent's change_consultation_request, with the new list (the whole
-- list: to add a service, the current ones and the new one). The note says
-- what it was.
drop function public.change_consultation_request(uuid, uuid, timestamptz, text, timestamptz, text);

create function public.change_consultation_request(
  p_business_id     uuid,
  p_conversation_id uuid,
  p_current_at      timestamptz,
  p_services        text[],
  p_preferred_at    timestamptz,
  -- The current time as the customer saw it, for the note:
  -- "Thursday, October 15, 2026 at 11:00 AM PDT".
  p_current_time    text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_req public.consultation_requests%rowtype;
begin
  select * into v_req from public.consultation_requests
   where business_id = p_business_id
     and conversation_id = p_conversation_id
     and preferred_at = p_current_at
     and status <> 'cancelled'
   for update;

  if v_req.id is null then
    -- A retry of a change that went through: it's already at the new time
    -- with the new services. Same answer, nothing written twice.
    select * into v_req from public.consultation_requests
     where business_id = p_business_id
       and conversation_id = p_conversation_id
       and preferred_at = p_preferred_at
       and services = p_services
       and status <> 'cancelled';
    if v_req.id is null then
      raise exception 'request_not_found' using errcode = 'P0002';
    end if;
    return jsonb_build_object('request_id', v_req.id, 'status', v_req.status, 'services', to_jsonb(v_req.services),
                              'service', v_req.service, 'changed', false);
  end if;

  if v_req.status <> 'pending' then
    raise exception 'request_not_pending' using errcode = 'P0001', detail = v_req.status;
  end if;

  if p_preferred_at <> p_current_at and exists (
    select 1 from public.consultation_requests
     where conversation_id = p_conversation_id
       and preferred_at = p_preferred_at
       and status <> 'cancelled'
  ) then
    raise exception 'slot_taken' using errcode = 'P0001';
  end if;

  update public.consultation_requests
     set services = p_services,
         preferred_at = p_preferred_at,
         notes = btrim(coalesce(notes, '') || format(' [Changed by the customer: was %s, %s.]', v_req.service, p_current_time))
   where id = v_req.id;

  return jsonb_build_object('request_id', v_req.id, 'status', 'pending', 'services', to_jsonb(p_services),
                            'service', public.services_label(p_services),
                            'previous_services', to_jsonb(v_req.services), 'previous_service', v_req.service,
                            'changed', true);
end;
$$;

revoke execute on function public.change_consultation_request(uuid, uuid, timestamptz, text[], timestamptz, text)
  from public, anon, authenticated;
