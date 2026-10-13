-- Tests for cancel_consultation_request() and request_follow_up(): only a
-- pending request in the same conversation is cancelled, a retry is safe,
-- the time is free again; a follow-up needs the contact saved, and there's
-- one open per conversation. Self-contained; rolled back. Run with
-- `npm run test:db`.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(15);

insert into businesses (id, slug, name) values ('00000000-0000-0000-0000-0000000000b3', 'test-cancel', 'Cancel');
insert into leads (id, business_id, name, phone, source_channel) values ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000b3', 'Mo', '01013514995', 'text');
insert into conversations (id, business_id, session_id, lead_id, customer_facts) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b3', gen_random_uuid(), '00000000-0000-0000-0000-0000000000a3', '{"name": "Mo", "phone": "01013514995"}'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000b3', gen_random_uuid(), null, '{}');
insert into consultation_requests (id, business_id, lead_id, conversation_id, contact_name, contact_phone, service, preferred_at, status) values
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000f1', 'Mo', '01013514995', 'Invisalign consultation', '2026-10-14 22:00+00', 'pending'),
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000f1', 'Mo', '01013514995', 'Retainers', '2026-10-15 22:00+00', 'confirmed');

-- Cancel -----------------------------------------------------------------------
select is((cancel_consultation_request('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000f1', '2026-10-14 22:00+00', 'changed my mind'))
          - 'request_id',
          '{"status": "cancelled", "service": "Invisalign consultation", "cancelled": true}'::jsonb, 'a pending request is cancelled');
select is((select status || '|' || notes from consultation_requests where id = '00000000-0000-0000-0000-0000000000e4'),
          'cancelled|[Cancelled by the customer: changed my mind.]', 'kept for staff, with a note and the reason');
select is((cancel_consultation_request('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000f1', '2026-10-14 22:00+00', ''))->>'cancelled',
          'false', 'a retry finds it already cancelled');
select is((select notes from consultation_requests where id = '00000000-0000-0000-0000-0000000000e4'),
          '[Cancelled by the customer: changed my mind.]', 'and notes it once');
select is((create_consultation_request('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000f1', 'Teeth whitening', '2026-10-14 22:00+00'))->>'created',
          'true', 'the time is free again for a new request');
select throws_ok($$ select cancel_consultation_request('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000f1', '2026-10-15 22:00+00', '') $$,
                 'P0001', 'request_not_pending', 'a confirmed request is the team''s: not cancelled');
select is((select status from consultation_requests where id = '00000000-0000-0000-0000-0000000000e5'), 'confirmed', 'it stays confirmed');
select throws_ok($$ select cancel_consultation_request('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000f2', '2026-10-15 22:00+00', '') $$,
                 'P0002', 'request_not_found', 'another conversation can''t cancel it');

-- Follow-ups -------------------------------------------------------------------
select is((request_follow_up('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000f1', '  Move the confirmed retainers appointment  '))->>'created',
          'true', 'a follow-up is recorded');
select is((select reason || '|' || status from follow_ups where conversation_id = '00000000-0000-0000-0000-0000000000f1'),
          'Move the confirmed retainers appointment|open', 'trimmed, open, for the conversation''s lead');
select is((request_follow_up('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000f1', 'Cancel the confirmed retainers appointment'))->>'created',
          'false', 'asking again updates the open one');
select is((select count(*)::int from follow_ups where conversation_id = '00000000-0000-0000-0000-0000000000f1'), 1, 'one open per conversation');
select throws_ok($$ select request_follow_up('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000f2', 'Call me') $$,
                 'P0001', 'lead_required', 'the contact must be saved first');
select throws_ok($$ update follow_ups set status = 'done' where conversation_id = '00000000-0000-0000-0000-0000000000f1' $$,
                 '23514', null, 'done needs done_at');

select ok(not has_function_privilege('anon', 'public.cancel_consultation_request(uuid, uuid, timestamptz, text)', 'execute')
      and not has_function_privilege('anon', 'public.request_follow_up(uuid, uuid, text)', 'execute'),
          'only the server can call them');

select * from finish();
rollback;
