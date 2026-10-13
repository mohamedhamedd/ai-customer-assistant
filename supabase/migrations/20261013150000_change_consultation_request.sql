-- A customer can change a consultation request they made, its service or
-- its time, while it's still pending (the agent's change_consultation_request
-- tool). Once staff have confirmed or cancelled it, it's theirs: the agent
-- offers to have the team get in touch instead.
--
-- In one statement, under a row lock, so a request staff confirm at the same
-- moment is either changed first or refused, never both. The request is the
-- one in this conversation at its current time (the slot is a request's
-- identity within a conversation: consultation_dedupe_by_slot). The previous
-- service and time are added to the notes, so staff see what changed.
create or replace function public.change_consultation_request(
  p_business_id     uuid,
  p_conversation_id uuid,
  p_current_at      timestamptz,
  p_service         text,
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
    -- with the new service. Same answer, nothing written twice.
    select * into v_req from public.consultation_requests
     where business_id = p_business_id
       and conversation_id = p_conversation_id
       and preferred_at = p_preferred_at
       and service = p_service
       and status <> 'cancelled';
    if v_req.id is null then
      raise exception 'request_not_found' using errcode = 'P0002';
    end if;
    return jsonb_build_object('request_id', v_req.id, 'status', v_req.status, 'service', v_req.service, 'changed', false);
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
     set service = p_service,
         preferred_at = p_preferred_at,
         notes = btrim(coalesce(notes, '') || format(' [Changed by the customer: was %s, %s.]', v_req.service, p_current_time))
   where id = v_req.id;

  return jsonb_build_object('request_id', v_req.id, 'status', 'pending', 'service', p_service, 'previous_service', v_req.service, 'changed', true);
end;
$$;

revoke execute on function public.change_consultation_request(uuid, uuid, timestamptz, text, timestamptz, text)
  from public, anon, authenticated;
