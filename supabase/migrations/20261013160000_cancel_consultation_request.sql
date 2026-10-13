-- A customer can cancel a consultation request they made, while it's still
-- pending (the agent's cancel_consultation_request tool). A confirmed
-- request is the team's: the agent offers a follow-up instead.
--
-- Under a row lock, like change_consultation_request: a request staff confirm
-- at the same moment is either cancelled first or refused. The request stays
-- (staff see it as cancelled, with a note), and its time is free again.
create or replace function public.cancel_consultation_request(
  p_business_id     uuid,
  p_conversation_id uuid,
  p_current_at      timestamptz,
  -- In the customer's words, optional: "found another clinic".
  p_reason          text
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
    -- A retry of a cancel that went through: the same answer, nothing twice.
    select * into v_req from public.consultation_requests
     where business_id = p_business_id
       and conversation_id = p_conversation_id
       and preferred_at = p_current_at
       and status = 'cancelled'
     order by updated_at desc
     limit 1;
    if v_req.id is null then
      raise exception 'request_not_found' using errcode = 'P0002';
    end if;
    return jsonb_build_object('request_id', v_req.id, 'status', 'cancelled', 'service', v_req.service, 'cancelled', false);
  end if;

  if v_req.status <> 'pending' then
    raise exception 'request_not_pending' using errcode = 'P0001', detail = v_req.status;
  end if;

  update public.consultation_requests
     set status = 'cancelled',
         notes = btrim(coalesce(notes, '') || ' [Cancelled by the customer'
                 || coalesce(': ' || nullif(btrim(p_reason), ''), '') || '.]')
   where id = v_req.id;

  return jsonb_build_object('request_id', v_req.id, 'status', 'cancelled', 'service', v_req.service, 'cancelled', true);
end;
$$;

revoke execute on function public.cancel_consultation_request(uuid, uuid, timestamptz, text)
  from public, anon, authenticated;
