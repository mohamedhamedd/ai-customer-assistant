-- Consultation dedupe by time slot, not by service wording (design I4).
--
-- Found in a live conversation: the model named the service "teeth whitening"
-- in one call and "teeth whitening consultation" in the next, so the
-- (conversation, lower(service), time) key saw two different requests and
-- created two pending ones for the same slot. Free-text names vary; the time
-- doesn't. A customer has one appointment at a given time, so within a
-- conversation the slot is the identity of a request.

-- Existing data may already hold duplicates under the new key (it did: the
-- live test that found this bug created two). A unique index can't be built
-- over them, so resolve them first: keep the earliest open request per slot
-- and cancel the later ones. Nothing is deleted; staff still see them.
update public.consultation_requests r
   set status = 'cancelled',
       notes = trim(coalesce(r.notes, '') || ' [Auto-cancelled: duplicate of an earlier request for the same time.]')
 where r.status <> 'cancelled'
   and exists (
     select 1 from public.consultation_requests o
      where o.conversation_id = r.conversation_id
        and o.preferred_at = r.preferred_at
        and o.status <> 'cancelled'
        and (o.created_at, o.id) < (r.created_at, r.id)
   );

drop index public.consultation_requests_dedupe_idx;
create unique index consultation_requests_dedupe_idx
  on public.consultation_requests (conversation_id, preferred_at)
  where status <> 'cancelled';

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
  v_service text;
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
  on conflict (conversation_id, preferred_at) where status <> 'cancelled' do nothing
  returning id, status, service into v_id, v_status, v_service;

  if v_id is null then
    v_created := false;
    select id, status, service into v_id, v_status, v_service
      from public.consultation_requests
     where conversation_id = p_conversation_id
       and preferred_at = p_preferred_at
       and status <> 'cancelled';
  end if;

  -- The stored service is returned so a repeat reports what was actually
  -- requested, not the new wording.
  return jsonb_build_object('request_id', v_id, 'status', v_status, 'service', v_service, 'created', v_created);
end;
$$;

revoke execute on function public.create_consultation_request(uuid, uuid, text, timestamptz, text)
  from public, anon, authenticated;
