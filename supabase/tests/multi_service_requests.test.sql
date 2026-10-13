-- Tests for one request with several services (one visit): the list, its
-- label, what the database refuses, and changing the list. Self-contained;
-- rolled back. Run with `npm run test:db`.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(11);

insert into businesses (id, slug, name) values ('00000000-0000-0000-0000-0000000000b5', 'test-multi', 'Multi');
insert into conversations (id, business_id, session_id) values
  ('00000000-0000-0000-0000-0000000000c7', '00000000-0000-0000-0000-0000000000b5', gen_random_uuid());
select save_lead('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000c7', 'text', 'Ana', null, '5550606001');

-- One visit, two services ---------------------------------------------------------
select is((create_consultation_request('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000c7',
            array['Women''s cut and style', 'Full colour'], '2026-10-24 14:00+00')) - 'request_id',
          '{"status": "pending", "services": ["Women''s cut and style", "Full colour"], "service": "Women''s cut and style, Full colour", "created": true}'::jsonb,
          'one request holds both services');
select is((select service from consultation_requests where conversation_id = '00000000-0000-0000-0000-0000000000c7'),
          'Women''s cut and style, Full colour', 'service is their label, for everything that shows a request');
select is((create_consultation_request('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000c7',
            array['Toner and gloss'], '2026-10-24 14:00+00'))->>'services',
          '["Women''s cut and style", "Full colour"]', 'another list at that time gets the request already there, for the tool to refuse');
select is((select count(*)::int from consultation_requests where conversation_id = '00000000-0000-0000-0000-0000000000c7'), 1, 'still one request');

-- Refused lists ----------------------------------------------------------------------
select throws_ok($$ select create_consultation_request('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000c7',
                   array[]::text[], '2026-10-27 14:00+00') $$, '23514', null, 'no services');
select throws_ok($$ select create_consultation_request('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000c7',
                   array['Full colour', 'full colour'], '2026-10-27 14:00+00') $$, '23514', null, 'the same service twice');
select throws_ok($$ select create_consultation_request('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000c7',
                   array['a', 'b', 'c', 'd', 'e', 'f'], '2026-10-27 14:00+00') $$, '23514', null, 'more than five');
select throws_ok($$ select create_consultation_request('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000c7',
                   array['Full colour', ' '], '2026-10-27 14:00+00') $$, '23514', null, 'a blank one');

-- Change the list: add one --------------------------------------------------------------
select is((change_consultation_request('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000c7',
            '2026-10-24 14:00+00', array['Women''s cut and style', 'Full colour', 'Toner and gloss'], '2026-10-24 14:00+00', 'Saturday, October 24, 2026 at 10:00 AM EDT'))->>'previous_service',
          'Women''s cut and style, Full colour', 'a change says what it was');
select is((select service from consultation_requests where conversation_id = '00000000-0000-0000-0000-0000000000c7'),
          'Women''s cut and style, Full colour, Toner and gloss', 'the visit has the new list');
select is((select notes from consultation_requests where conversation_id = '00000000-0000-0000-0000-0000000000c7'),
          '[Changed by the customer: was Women''s cut and style, Full colour, Saturday, October 24, 2026 at 10:00 AM EDT.]',
          'and staff see what it was');

select * from finish();
rollback;
