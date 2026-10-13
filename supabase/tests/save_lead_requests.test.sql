-- Tests for save_lead() keeping this conversation's requests in step with
-- the customer's corrected contact details. Self-contained; rolled back.
-- Run with `npm run test:db`.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(10);

insert into businesses (id, slug, name) values ('00000000-0000-0000-0000-0000000000b4', 'test-contact', 'Contact');
insert into conversations (id, business_id, session_id) values
  ('00000000-0000-0000-0000-0000000000c5', '00000000-0000-0000-0000-0000000000b4', gen_random_uuid()),
  ('00000000-0000-0000-0000-0000000000c6', '00000000-0000-0000-0000-0000000000b4', gen_random_uuid());

-- The customer saves their details and makes three requests.
select save_lead('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000c5', 'text', 'Khaled Raof', null, '01013514995');
select create_consultation_request('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000c5', 'Root canal', '2026-10-20 22:00+00');
select create_consultation_request('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000c5', 'Crown', '2026-10-21 22:00+00');
select create_consultation_request('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000c5', 'Retainers', '2026-10-22 22:00+00');
update consultation_requests set status = 'confirmed' where service = 'Crown' and conversation_id = '00000000-0000-0000-0000-0000000000c5';
update consultation_requests set status = 'cancelled' where service = 'Retainers' and conversation_id = '00000000-0000-0000-0000-0000000000c5';
-- Another conversation's request with the same phone stays as it is.
select save_lead('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000c6', 'text', 'Someone', null, '01013514995');
select create_consultation_request('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000c6', 'Cleaning', '2026-10-20 22:00+00');

-- Seen live: the customer corrects their phone number.
select is((save_lead('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000c5', 'text', 'Khaled Raof', null, '01013514998'))
          - 'lead_id',
          '{"created": true, "requests_noted": 1, "requests_updated": 1}'::jsonb, 'one pending updated, one confirmed noted');
select is((select contact_phone || '|' || contact_name from consultation_requests where service = 'Root canal'),
          '01013514998|Khaled Raof', 'the pending request has the new number');
select is((select lead_id from consultation_requests where service = 'Root canal'),
          (select lead_id from conversations where id = '00000000-0000-0000-0000-0000000000c5'), 'and the new contact''s lead');
select is((select notes from consultation_requests where service = 'Root canal'),
          '[Contact changed by the customer: was Khaled Raof, 01013514995.]', 'with a note of what it was');
select is((select contact_phone || '|' || notes from consultation_requests where service = 'Crown'),
          '01013514995|[The customer gave new contact details in the chat: Khaled Raof, 01013514998.]',
          'a confirmed request keeps what staff confirmed with, and gets a note');
select is((select contact_phone || '|' || coalesce(notes, '') from consultation_requests where service = 'Retainers'),
          '01013514995|', 'a cancelled request is left alone');
select is((select contact_phone from consultation_requests where service = 'Cleaning'), '01013514995', 'another conversation''s request is left alone');

-- Saving the same details again changes nothing, and notes nothing twice.
select is((save_lead('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000c5', 'text', 'Khaled Raof', null, '01013514998'))
          - 'lead_id' - 'created',
          '{"requests_noted": 0, "requests_updated": 0}'::jsonb, 'the same details: nothing to change');
select is((select notes from consultation_requests where service = 'Crown'),
          '[The customer gave new contact details in the chat: Khaled Raof, 01013514998.]', 'noted once');
select ok(not has_function_privilege('anon', 'public.save_lead(uuid, uuid, text, text, text, text, text)', 'execute'), 'only the server can call it');

select * from finish();
rollback;
