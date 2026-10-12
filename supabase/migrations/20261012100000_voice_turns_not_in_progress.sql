-- Only text turns are "in progress" (design §7.1).
--
-- A voice question is answered by the Realtime session, and its answer is a
-- separate voice row, not linked through reply_to_message_id. Counting voice
-- questions here made every text message in the 60 s after a voice call get
-- a 409 ("still answering your previous message"). Found in live testing.
create or replace function public.turn_in_progress(p_conversation_id uuid, p_except_message_id bigint, p_window_seconds int)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.messages m
     where m.conversation_id = p_conversation_id
       and m.role = 'user'
       and m.channel = 'text'
       and m.id is distinct from p_except_message_id
       and m.reply_failed_at is null
       and m.reply_attempt_at > now() - make_interval(secs => p_window_seconds)
       and not exists (select 1 from public.messages r where r.reply_to_message_id = m.id)
  );
$$;
