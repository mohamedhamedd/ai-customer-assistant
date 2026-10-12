-- When the server last tried to hang up a call that ran past its time
-- limit. Attempts are claimed atomically and spaced at least a minute
-- apart, so a call OpenAI no longer knows (or a brief OpenAI outage) costs
-- at most one hang-up request a minute, not one per incoming request.
-- Nullable, no default: no rewrite.
alter table public.voice_calls add column hangup_attempted_at timestamptz;
