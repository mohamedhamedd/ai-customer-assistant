-- Tests for change_consultation_request(): only a pending request in the
-- same conversation, never onto another request's slot, a safe retry, and
-- what changed recorded for staff. Self-contained; rolled back. Run with
-- `npm run test:db`.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(12);

insert into businesses (id, slug, name) values ('00000000-0000-0000-0000-0000000000b2', 'test-change', 'Change');
insert into leads (id, business_id, name, email, source_channel) values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b2', 'Sara', 'sara@change.example', 'text');
insert into conversations (id, business_id, session_id, lead_id) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b2', gen_random_uuid(), '00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000b2', gen_random_uuid(), '00000000-0000-0000-0000-0000000000a2');
insert into consultation_requests (id, business_id, lead_id, conversation_id, contact_name, contact_email, service, preferred_at, status) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000d1', 'Sara', 'sara@change.example', 'Porcelain crown', '2026-10-20 22:00+00', 'pending'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000d1', 'Sara', 'sara@change.example', 'Fluoride treatment', '2026-10-23 17:00+00', 'pending'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000d1', 'Sara', 'sara@change.example', 'Retainers', '2026-10-26 17:00+00', 'confirmed');

-- A pending request: changed, with the change noted for staff -------------------
select is((change_consultation_request('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000d1',
            '2026-10-20 22:00+00', 'Porcelain veneer', '2026-10-22 17:00+00', 'Tuesday, October 20, 2026 at 3:00 PM PDT'))
          - 'request_id',
          '{"status": "pending", "service": "Porcelain veneer", "previous_service": "Porcelain crown", "changed": true}'::jsonb,
          'a pending request is changed, and says what it was');
select is((select service || '|' || preferred_at::text from consultation_requests where id = '00000000-0000-0000-0000-0000000000e1'),
          'Porcelain veneer|' || '2026-10-22 17:00:00+00', 'the same request, with the new service and time');
select is((select notes from consultation_requests where id = '00000000-0000-0000-0000-0000000000e1'),
          '[Changed by the customer: was Porcelain crown, Tuesday, October 20, 2026 at 3:00 PM PDT.]', 'what changed is in the notes');
select is((select count(*)::int from consultation_requests where conversation_id = '00000000-0000-0000-0000-0000000000d1'), 3, 'no second request');

-- A retry after it went through: the same answer, nothing written twice -----------
select is((change_consultation_request('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000d1',
            '2026-10-20 22:00+00', 'Porcelain veneer', '2026-10-22 17:00+00', 'Tuesday, October 20, 2026 at 3:00 PM PDT'))->>'changed',
          'false', 'a retry finds it already changed');
select is((select notes from consultation_requests where id = '00000000-0000-0000-0000-0000000000e1'),
          '[Changed by the customer: was Porcelain crown, Tuesday, October 20, 2026 at 3:00 PM PDT.]', 'and notes it once');

-- Refused ---------------------------------------------------------------------------
select throws_ok($$ select change_consultation_request('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000d1',
                   '2026-10-26 17:00+00', 'Retainers', '2026-10-27 17:00+00', 'x') $$,
                 'P0001', 'request_not_pending', 'a confirmed request is the team''s: not changed');
select is((select preferred_at::text from consultation_requests where id = '00000000-0000-0000-0000-0000000000e3'), '2026-10-26 17:00:00+00', 'it stays as it was');
select throws_ok($$ select change_consultation_request('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000d1',
                   '2026-10-23 17:00+00', 'Fluoride treatment', '2026-10-22 17:00+00', 'x') $$,
                 'P0001', 'slot_taken', 'not onto the time of another request');
select throws_ok($$ select change_consultation_request('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000d2',
                   '2026-10-23 17:00+00', 'Fluoride treatment', '2026-10-24 17:00+00', 'x') $$,
                 'P0002', 'request_not_found', 'another conversation can''t change it');
select throws_ok($$ select change_consultation_request('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000d1',
                   '2026-11-01 17:00+00', 'Fluoride treatment', '2026-11-02 17:00+00', 'x') $$,
                 'P0002', 'request_not_found', 'no request at that time');

select ok(not has_function_privilege('anon', 'public.change_consultation_request(uuid, uuid, timestamptz, text, timestamptz, text)', 'execute')
      and not has_function_privilege('authenticated', 'public.change_consultation_request(uuid, uuid, timestamptz, text, timestamptz, text)', 'execute'),
          'only the server can call it');

select * from finish();
rollback;
