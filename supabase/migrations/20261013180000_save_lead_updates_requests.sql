-- A customer who corrects their contact details in the chat corrects them on
-- their consultation requests too. Seen live: a customer changed their phone
-- number after requesting a consultation; save_lead linked the conversation
-- to the new contact, but the request kept the old number in its contact
-- snapshot, the one staff call, while the assistant said "updated".
--
-- save_lead now updates this conversation's pending requests (and notes what
-- the contact was), notes the new details on confirmed ones, and says how
-- many, so the assistant can tell the customer exactly what changed.
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
  v_facts   jsonb;
  v_req     public.consultation_requests%rowtype;
  v_old     text;
  v_new     text;
  v_note    text;
  v_updated int := 0;
  v_noted   int := 0;
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

  update public.conversations set lead_id = v_lead.id where id = p_conversation_id
  returning customer_facts into v_facts;

  -- The customer's requests in this conversation follow the details they
  -- just confirmed (customer_facts, as merged above). A pending one takes
  -- them, and notes what they were; a confirmed one keeps what staff
  -- confirmed with, and gets a note with the new details. Cancelled ones
  -- stay as they are.
  v_new := concat_ws(', ', v_facts ->> 'name', v_facts ->> 'phone', v_facts ->> 'email');
  for v_req in
    select * from public.consultation_requests
     where conversation_id = p_conversation_id and status <> 'cancelled'
     order by created_at
       for update
  loop
    continue when v_req.contact_name is not distinct from (v_facts ->> 'name')
              and v_req.contact_email is not distinct from (v_facts ->> 'email')
              and v_req.contact_phone is not distinct from (v_facts ->> 'phone');
    v_old := concat_ws(', ', v_req.contact_name, v_req.contact_phone, v_req.contact_email);
    if v_req.status = 'pending' then
      update public.consultation_requests
         set lead_id = v_lead.id,
             contact_name = v_facts ->> 'name',
             contact_email = v_facts ->> 'email',
             contact_phone = v_facts ->> 'phone',
             notes = btrim(coalesce(notes, '') || format(' [Contact changed by the customer: was %s.]', v_old))
       where id = v_req.id;
      v_updated := v_updated + 1;
    else
      v_note := format('[The customer gave new contact details in the chat: %s.]', v_new);
      if position(v_note in coalesce(v_req.notes, '')) = 0 then
        update public.consultation_requests set notes = btrim(coalesce(notes, '') || ' ' || v_note) where id = v_req.id;
        v_noted := v_noted + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object('lead_id', v_lead.id, 'created', v_created, 'requests_updated', v_updated, 'requests_noted', v_noted);
end;
$$;

revoke execute on function public.save_lead(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
