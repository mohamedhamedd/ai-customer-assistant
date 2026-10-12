-- Rate limits (PR-13, US-12.6): counters in Postgres, so a limit holds
-- across server restarts and several app instances.
--
-- Fixed windows: one row per (key, window start). Simple and cheap; the
-- trade-off is that a client can do up to twice the limit across a window
-- boundary, which is fine for abuse protection (not for billing).
create table public.rate_limit_hits (
  key          text not null,
  window_start timestamptz not null,
  hits         int not null default 1,
  primary key (key, window_start)
);

-- Counts this request and says whether it is allowed. Atomic: concurrent
-- requests with the same key serialise on the row.
create or replace function public.take_rate_limit(p_key text, p_window_seconds int, p_max int)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits   int;
begin
  insert into public.rate_limit_hits as r (key, window_start)
  values (p_key, v_window)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning hits into v_hits;

  -- Old windows for this key are no longer needed.
  delete from public.rate_limit_hits where key = p_key and window_start < v_window;

  return v_hits <= p_max;
end;
$$;

revoke execute on function public.take_rate_limit(text, int, int) from public, anon, authenticated;
revoke all on public.rate_limit_hits from anon, authenticated;
alter table public.rate_limit_hits enable row level security;
