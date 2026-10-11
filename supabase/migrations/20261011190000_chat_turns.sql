-- Two additions for the chat turn (design doc §3.5, §7.1).

-- The action cards an assistant reply produced ("details saved",
-- "consultation requested"), so they survive a page reload. Copied from tool
-- results by the server; the model never writes this.
alter table public.messages
  add column actions jsonb not null default '[]'::jsonb;

-- Set on a USER message when the server gave up producing its reply (model
-- error, turn deadline). The retry rule (§7.1) otherwise can't tell a failed
-- turn from one still running: without this, a retry within 60 s of an
-- OpenAI outage would get "in progress" instead of a fresh attempt.
alter table public.messages
  add column reply_failed_at timestamptz,
  add constraint messages_reply_failed_only_on_user check (reply_failed_at is null or role = 'user');

-- When the latest attempt to answer a USER message started (the first one is
-- the insert). The in-progress window is measured from here, not from
-- created_at: a re-run of an hour-old message is still "in progress" for its
-- own 60 seconds.
alter table public.messages
  add column reply_attempt_at timestamptz not null default now();

-- "In progress" (design §7.1), defined once: a user message with no reply,
-- not marked failed, whose latest attempt started within the window.
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
       and m.id is distinct from p_except_message_id
       and m.reply_failed_at is null
       and m.reply_attempt_at > now() - make_interval(secs => p_window_seconds)
       and not exists (select 1 from public.messages r where r.reply_to_message_id = m.id)
  );
$$;

-- Start a turn for a new customer message: one turn at a time per
-- conversation. Locking the conversation row serialises concurrent calls, so
-- "check nothing is running, then insert" can't interleave. Returns
-- {status: created | exists | busy, message_id}.
create or replace function public.begin_user_message(
  p_conversation_id   uuid,
  p_client_message_id text,
  p_content           text,
  p_window_seconds    int,
  p_channel           text default 'text'
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_id bigint;
begin
  perform 1 from public.conversations where id = p_conversation_id for update;

  select id into v_id from public.messages
   where conversation_id = p_conversation_id and client_message_id = p_client_message_id;
  if v_id is not null then
    return jsonb_build_object('status', 'exists', 'message_id', v_id);
  end if;

  if public.turn_in_progress(p_conversation_id, null, p_window_seconds) then
    return jsonb_build_object('status', 'busy');
  end if;

  insert into public.messages (conversation_id, client_message_id, role, channel, content)
  values (p_conversation_id, p_client_message_id, 'user', p_channel, p_content)
  returning id into v_id;
  return jsonb_build_object('status', 'created', 'message_id', v_id);
end;
$$;

-- Claim a re-run of a user message's reply (design §7.1). Under the same
-- conversation lock: the message must be failed or stale and unanswered, and
-- no OTHER turn in the conversation may be running. Two concurrent retries
-- can't both win: the second waits on the lock and then finds the message
-- freshly claimed. Returns true only for the caller that should run the turn.
create or replace function public.claim_reply_attempt(p_message_id bigint, p_window_seconds int)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_conversation uuid;
begin
  select conversation_id into v_conversation from public.messages where id = p_message_id and role = 'user';
  if v_conversation is null then
    return false;
  end if;
  perform 1 from public.conversations where id = v_conversation for update;

  if public.turn_in_progress(v_conversation, p_message_id, p_window_seconds) then
    return false;
  end if;

  update public.messages
     set reply_failed_at = null, reply_attempt_at = now()
   where id = p_message_id
     and not exists (select 1 from public.messages r where r.reply_to_message_id = p_message_id)
     and (reply_failed_at is not null or reply_attempt_at < now() - make_interval(secs => p_window_seconds));
  return found;
end;
$$;

revoke execute on function public.turn_in_progress(uuid, bigint, int) from public, anon, authenticated;
revoke execute on function public.begin_user_message(uuid, text, text, int, text) from public, anon, authenticated;
revoke execute on function public.claim_reply_attempt(bigint, int) from public, anon, authenticated;
