-- The agent's two write actions, each one atomic transaction (design doc
-- §3.7, §3.8, §4). Input validation (formats, dates) happens in TypeScript
-- before these are called, where the error messages are written for the
-- model; these functions own the invariants and the matching rules.
--
-- Both are called by the server with ids it controls. The model never
-- supplies business_id or conversation_id.

-- save_lead: record what the visitor said, then match or create the lead.
--
-- Anyone can type any email, so a match is not proof of identity:
--   - what the visitor said always goes to conversations.customer_facts,
--     which is the only customer memory the agent sees (§7);
--   - an existing lead is linked but never overwritten: only empty fields
--     are filled, and a value that belongs to another lead is skipped;
--   - email is matched first, then phone; no merging of leads.
create or replace function public.save_lead(
  p_business_id     uuid,
  p_conversation_id uuid,
  p_channel         text,
  p_name            text,
  p_email           text default null,
  p_phone           text default null,
  p_interest        text default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_lead    public.leads%rowtype;
  v_created boolean := false;
begin
  update public.conversations
     set customer_facts = customer_facts || jsonb_strip_nulls(jsonb_build_object(
           'name', p_name, 'email', p_email, 'phone', p_phone, 'interest', p_interest))
   where id = p_conversation_id and business_id = p_business_id;
  if not found then
    raise exception 'conversation % not found', p_conversation_id using errcode = 'P0002';
  end if;

  if p_email is not null then
    select * into v_lead from public.leads where business_id = p_business_id and email = p_email;
  end if;
  if v_lead.id is null and p_phone is not null then
    select * into v_lead from public.leads where business_id = p_business_id and phone = p_phone;
  end if;

  if v_lead.id is null then
    begin
      insert into public.leads (business_id, name, email, phone, interest, source_channel)
      values (p_business_id, p_name, p_email, p_phone, p_interest, p_channel)
      returning * into v_lead;
      v_created := true;
    exception when unique_violation then
      -- A concurrent save_lead created the same contact first: match again.
      select * into v_lead from public.leads
       where business_id = p_business_id
         and ((p_email is not null and email = p_email) or (p_phone is not null and phone = p_phone))
       order by (email is not distinct from p_email) desc
       limit 1;
    end;
  else
    if v_lead.email is null and p_email is not null then
      begin
        update public.leads set email = p_email where id = v_lead.id;
      exception when unique_violation then
        null; -- the email belongs to another lead; it stays in customer_facts
      end;
    end if;
    if v_lead.phone is null and p_phone is not null then
      begin
        update public.leads set phone = p_phone where id = v_lead.id;
      exception when unique_violation then
        null;
      end;
    end if;
    if v_lead.interest is null and p_interest is not null then
      update public.leads set interest = p_interest where id = v_lead.id;
    end if;
  end if;

  update public.conversations set lead_id = v_lead.id where id = p_conversation_id;
  return jsonb_build_object('lead_id', v_lead.id, 'created', v_created);
end;
$$;

-- create_consultation_request: a request, never a booking (§6.2).
--
-- The contact snapshot comes from customer_facts, i.e. what this visitor
-- gave, not from the (possibly shared) lead row, so staff always contact
-- the person who asked (§3.8). Dedupe is per conversation (I4): a retry or
-- a repeated request returns the existing row instead of a duplicate.
create or replace function public.create_consultation_request(
  p_business_id     uuid,
  p_conversation_id uuid,
  p_service         text,
  p_preferred_at    timestamptz,
  p_notes           text default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_conv    public.conversations%rowtype;
  v_id      uuid;
  v_status  text;
  v_created boolean := true;
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
     service, preferred_at, notes)
  values
    (p_business_id, v_conv.lead_id, p_conversation_id,
     v_conv.customer_facts->>'name', v_conv.customer_facts->>'email', v_conv.customer_facts->>'phone',
     p_service, p_preferred_at, p_notes)
  on conflict (conversation_id, lower(service), preferred_at) do nothing
  returning id, status into v_id, v_status;

  if v_id is null then
    v_created := false;
    select id, status into v_id, v_status
      from public.consultation_requests
     where conversation_id = p_conversation_id
       and lower(service) = lower(p_service)
       and preferred_at = p_preferred_at;
  end if;

  return jsonb_build_object('request_id', v_id, 'status', v_status, 'created', v_created);
end;
$$;

revoke execute on function public.save_lead(uuid, uuid, text, text, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.create_consultation_request(uuid, uuid, text, timestamptz, text)
  from public, anon, authenticated;
