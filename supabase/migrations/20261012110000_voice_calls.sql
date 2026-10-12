-- Voice calls (PR-09 review).
--
-- 1. Every voice request after the call starts must prove it belongs to a
--    live call: the server issues a random secret when it opens the call and
--    stores only its hash. Without it, /api/voice/tool was a direct API to
--    the write tools and to paid searches for anyone with a session id.
-- 2. A voice answer's citations and cards come from the exact tool calls it
--    used: each tool call records the call it ran in and its Realtime call
--    id, and is attached to one answer (message_id), once.

create table public.voice_calls (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  -- sha256 of the secret, hex. The secret itself is only ever in the browser.
  token_hash      text not null unique,
  -- OpenAI's id for the call (from the Location header), for hanging up later.
  openai_call_id  text,
  expires_at      timestamptz not null,
  created_at      timestamptz not null default now()
);

create index voice_calls_conversation_id_idx on public.voice_calls (conversation_id);

alter table public.tool_calls
  add column voice_call_id    uuid references public.voice_calls(id) on delete set null,
  add column realtime_call_id text,
  add column message_id       bigint references public.messages(id) on delete set null;

create index tool_calls_voice_call_id_idx on public.tool_calls (voice_call_id) where voice_call_id is not null;
create index tool_calls_message_id_idx on public.tool_calls (message_id) where message_id is not null;

-- Same rule as every table (init migration): no access for anon or
-- authenticated, and RLS on as a second line of defence.
revoke all on public.voice_calls from anon, authenticated;
alter table public.voice_calls enable row level security;
