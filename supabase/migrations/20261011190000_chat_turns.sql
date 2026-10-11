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

-- Claim a re-run of a user message's reply (design §7.1). One conditional
-- UPDATE, so two concurrent retries can't both win: the second waits on the
-- row lock, re-checks the condition after the first commits, and finds it
-- false. Returns true only for the caller that should run the turn.
create or replace function public.claim_reply_attempt(p_message_id bigint, p_window_seconds int)
returns boolean
language sql
set search_path = ''
as $$
  with claimed as (
    update public.messages
       set reply_failed_at = null, reply_attempt_at = now()
     where id = p_message_id
       and role = 'user'
       and not exists (select 1 from public.messages r where r.reply_to_message_id = p_message_id)
       and (reply_failed_at is not null or reply_attempt_at < now() - make_interval(secs => p_window_seconds))
    returning 1
  )
  select exists (select 1 from claimed);
$$;

revoke execute on function public.claim_reply_attempt(bigint, int) from public, anon, authenticated;
