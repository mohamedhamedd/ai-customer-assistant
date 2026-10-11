-- Tests for save_lead() and create_consultation_request(): the matching,
-- no-overwrite and dedupe rules from design doc §3.7, §3.8 and §4.
-- Self-contained; rolled back. Run with `npm run test:db`.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(34);

insert into businesses (id, slug, name) values ('00000000-0000-0000-0000-0000000000b1', 'test-tools', 'Tools');
insert into conversations (id, business_id, session_id) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', gen_random_uuid()),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000b1', gen_random_uuid()),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000b1', gen_random_uuid()),
  ('00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-0000000000b1', gen_random_uuid());

-- New lead -------------------------------------------------------------------
select is((save_lead('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'text',
                     'Sara Ali', 'sara@x.com', null, 'whitening'))->>'created',
          'true', 'a new contact creates a lead');
select is((select count(*)::int from leads where business_id = '00000000-0000-0000-0000-0000000000b1'), 1, 'one lead');
select is((select customer_facts from conversations where id = '00000000-0000-0000-0000-0000000000c1'),
          '{"name": "Sara Ali", "email": "sara@x.com", "interest": "whitening"}'::jsonb,
          'what the visitor said is recorded in customer_facts');
select isnt((select lead_id from conversations where id = '00000000-0000-0000-0000-0000000000c1'), null,
            'the conversation is linked to the lead');

-- Same email from a stranger: linked, never overwritten -----------------------
select is((save_lead('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c2', 'voice',
                     'Someone Else', 'sara@x.com', '5035550000', 'braces'))->>'created',
          'false', 'an existing email matches instead of creating a duplicate');
select is((select count(*)::int from leads where business_id = '00000000-0000-0000-0000-0000000000b1'), 1, 'still one lead');
select is((select name || '|' || interest from leads where email = 'sara@x.com'), 'Sara Ali|whitening',
          'existing name and interest are not overwritten');
select is((select phone from leads where email = 'sara@x.com'), '5035550000', 'an empty field (phone) is filled');
select is((select customer_facts->>'name' from conversations where id = '00000000-0000-0000-0000-0000000000c2'),
          'Someone Else', 'the stranger''s own details stay in their conversation''s facts');

-- Collision when filling: value belongs to another lead -----------------------
select save_lead('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c3', 'text',
                 'Bob', 'bob@x.com', null, null);
-- c4 gives a NEW phone (matches nobody) plus Bob's email -> matches Bob by email,
-- fills Bob's empty phone.
select save_lead('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c4', 'text',
                 'Robert', 'bob@x.com', '5035551111', null);
select is((select phone from leads where email = 'bob@x.com'), '5035551111', 'match by email fills the empty phone');
-- Now Sara's phone (5035550000) arrives with Bob's email: email wins (links Bob),
-- and Sara's phone is not moved or duplicated.
select lives_ok($$ select save_lead('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c4', 'text',
                                    'Robert', 'bob@x.com', '5035550000', null) $$,
                'email of lead A + phone of lead B does not fail');
select is((select phone from leads where email = 'bob@x.com'), '5035551111', 'lead A keeps its phone');
select is((select phone from leads where email = 'sara@x.com'), '5035550000', 'lead B keeps its phone');

-- Carol has no phone; she is matched by email and offered Sara's phone. Filling
-- it would violate the unique phone: the fill is skipped, nothing fails.
insert into leads (business_id, name, email, source_channel)
values ('00000000-0000-0000-0000-0000000000b1', 'Carol', 'carol@x.com', 'text');
select lives_ok($$ select save_lead('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c3', 'text',
                                    'Carol', 'carol@x.com', '5035550000', null) $$,
                'filling an empty field with another lead''s value does not fail');
select is((select phone from leads where email = 'carol@x.com'), null,
          'the colliding value is skipped (it stays in customer_facts only)');

-- Consultation requests --------------------------------------------------------
update conversations set lead_id = null, customer_facts = '{}' where id = '00000000-0000-0000-0000-0000000000c3';
select throws_ok($$ select create_consultation_request('00000000-0000-0000-0000-0000000000b1',
                     '00000000-0000-0000-0000-0000000000c3', 'Whitening', '2026-10-20 22:00+00') $$,
                 'P0001', 'lead_required', 'no saved contact -> lead_required');

select is((create_consultation_request('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c2',
                                       'Teeth Whitening', '2026-10-20 22:00+00', 'mornings better'))->>'status',
          'pending', 'a request is created as pending');
select is((select contact_name || '|' || coalesce(contact_phone, '') from consultation_requests
            where conversation_id = '00000000-0000-0000-0000-0000000000c2'),
          'Someone Else|5035550000',
          'the contact snapshot is the requester (from facts), not the shared lead');
select is((create_consultation_request('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c2',
                                       'teeth whitening', '2026-10-20 22:00+00'))->>'created',
          'false', 'the same request again (different case) returns the existing one');
select is((create_consultation_request('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c2',
                                       'whitening consultation', '2026-10-20 22:00+00'))->>'service',
          'Teeth Whitening', 'the same slot with different service wording is the same request, reported as first named');

-- Staff cancel it; asking for the same slot again creates a NEW request.
update consultation_requests set status = 'cancelled' where conversation_id = '00000000-0000-0000-0000-0000000000c2';
select is((create_consultation_request('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c2',
                                       'Teeth Whitening', '2026-10-20 22:00+00'))->>'created',
          'true', 'a cancelled request does not block re-requesting the same slot');
select is((select count(*)::int from consultation_requests
            where conversation_id = '00000000-0000-0000-0000-0000000000c2' and status = 'pending'), 1,
          'one pending request alongside the cancelled one');

-- claim_reply_attempt: exactly one retry wins ---------------------------------
insert into messages (id, conversation_id, role, content, client_message_id, reply_attempt_at)
overriding system value values
  (900001, '00000000-0000-0000-0000-0000000000c1', 'user', 'fresh',    'm-fresh', now()),
  (900002, '00000000-0000-0000-0000-0000000000c2', 'user', 'old',      'm-old',   now() - interval '5 minutes'),
  (900003, '00000000-0000-0000-0000-0000000000c3', 'user', 'answered', 'm-ans',   now() - interval '5 minutes');
insert into messages (conversation_id, role, content, reply_to_message_id)
values ('00000000-0000-0000-0000-0000000000c3', 'assistant', 'the answer', 900003);
update messages set reply_failed_at = now() where id = 900001;

select is(claim_reply_attempt(900001, 60), true,  'a failed turn can be claimed at once');
select is(claim_reply_attempt(900001, 60), false, 'a second claim right after loses (the attempt is fresh again)');
select is(claim_reply_attempt(900002, 60), true,  'an attempt older than the window can be claimed');
select is(claim_reply_attempt(900003, 60), false, 'a message that already has a reply is never re-run');
select ok((select reply_failed_at is null and reply_attempt_at > now() - interval '1 minute' from messages where id = 900001),
          'claiming clears the failure flag and restarts the window');

-- begin_user_message: one turn at a time per conversation ----------------------
-- c1 now has 900001 in progress (just claimed, no reply).
select is((begin_user_message('00000000-0000-0000-0000-0000000000c1', 'm-next', 'next question', 60))->>'status',
          'busy', 'a new message while another turn runs in the conversation is refused');
select is((select count(*)::int from messages where client_message_id = 'm-next'), 0, 'and nothing is inserted');
select is((begin_user_message('00000000-0000-0000-0000-0000000000c1', 'm-fresh', 'fresh', 60))->>'status',
          'exists', 'a retry of a known message is reported as existing, not busy');
insert into messages (conversation_id, role, content, reply_to_message_id)
values ('00000000-0000-0000-0000-0000000000c1', 'assistant', 'answer to fresh', 900001);
select is((begin_user_message('00000000-0000-0000-0000-0000000000c1', 'm-next', 'next question', 60))->>'status',
          'created', 'once the running turn has its reply, the next message is accepted');
insert into messages (id, conversation_id, role, content, client_message_id, reply_attempt_at)
overriding system value values (900004, '00000000-0000-0000-0000-0000000000c4', 'user', 'other', 'm-other', now() - interval '5 minutes');
update messages set reply_failed_at = now() where id = 900004;
select is((begin_user_message('00000000-0000-0000-0000-0000000000c4', 'm-after-fail', 'new', 60))->>'status',
          'created', 'a failed turn does not block new messages');
-- c1: 'm-next' is now running; a retry of an older message there must wait.
update messages set reply_failed_at = now() where id = 900001;
delete from messages where reply_to_message_id = 900001;
select is(claim_reply_attempt(900001, 60), false, 'a re-run is refused while another turn in the conversation runs');

select ok(not has_function_privilege('anon', 'public.save_lead(uuid, uuid, text, text, text, text, text)', 'execute')
      and not has_function_privilege('anon', 'public.create_consultation_request(uuid, uuid, text, timestamptz, text)', 'execute'),
          'anon cannot execute the tool functions');

select * from finish();
rollback;
