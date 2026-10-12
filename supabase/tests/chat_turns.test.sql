-- Tests for the one-turn-at-a-time rule (design §7.1): which messages count
-- as a turn still being answered. Self-contained; rolled back.
-- Run with `npm run test:db`.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(4);

insert into businesses (id, slug, name) values ('00000000-0000-0000-0000-0000000000b2', 'test-turns', 'Turns');
insert into conversations (id, business_id, session_id) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b2', gen_random_uuid()),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000b2', gen_random_uuid());

-- A voice question just asked (answered by the Realtime session, not linked).
insert into messages (conversation_id, client_message_id, role, channel, content)
values ('00000000-0000-0000-0000-0000000000d1', 'item_voice1', 'user', 'voice', 'When are you open?');

select is(turn_in_progress('00000000-0000-0000-0000-0000000000d1', null, 60), false,
          'an unanswered voice question is not a text turn in progress');
select is(begin_user_message('00000000-0000-0000-0000-0000000000d1', 'c-after-voice', 'Typed after the call', 60)->>'status',
          'created', 'typing right after a voice call starts a turn');

-- A text question still being answered blocks the next one.
select is(begin_user_message('00000000-0000-0000-0000-0000000000d2', 'c-first', 'First', 60)->>'status', 'created', 'first text turn starts');
select is(begin_user_message('00000000-0000-0000-0000-0000000000d2', 'c-second', 'Second', 60)->>'status',
          'busy', 'a second text message while the first is unanswered is busy');

select * from finish();
rollback;
