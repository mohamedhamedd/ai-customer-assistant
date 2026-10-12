-- Rate-limit rows for keys that never come back (most browser sessions)
-- were never deleted. prune_rate_limits() removes every window older than
-- an hour (the longest window is 10 minutes); take_rate_limit() calls it on
-- about 1 request in 100, so the table stays small without a scheduler.
create index rate_limit_hits_window_start_idx on public.rate_limit_hits (window_start);

create or replace function public.prune_rate_limits()
returns int
language sql
set search_path = ''
as $$
  with gone as (
    delete from public.rate_limit_hits where window_start < now() - interval '1 hour' returning 1
  )
  select count(*)::int from gone;
$$;

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

  -- Old windows for this key are no longer needed; now and then, everyone's.
  delete from public.rate_limit_hits where key = p_key and window_start < v_window;
  if random() < 0.01 then
    perform public.prune_rate_limits();
  end if;

  return v_hits <= p_max;
end;
$$;

revoke execute on function public.prune_rate_limits() from public, anon, authenticated;
revoke execute on function public.take_rate_limit(text, int, int) from public, anon, authenticated;
