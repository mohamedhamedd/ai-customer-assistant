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
