-- A business's opening hours, as a table (step 3 of structured knowledge):
-- one row per time range, so a day with a lunch break has two rows and a
-- closed day has none. Times are the business's local time (its timezone).
-- A consultation request for a time the business is closed is refused in
-- code (src/lib/agent/tools.ts), instead of trusting the model to check.
-- Not covered yet: closures on given dates (holidays) and every-other-week
-- days; those stay in the documents.
create table public.opening_hours (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  -- ISO weekday: 1 = Monday ... 7 = Sunday.
  day         smallint not null check (day between 1 and 7),
  opens       time not null,
  -- 00:00 closes at midnight.
  closes      time not null,
  created_at  timestamptz not null default now(),
  check (closes > opens or closes = '00:00'),
  unique (business_id, day, opens)
);

revoke all on public.opening_hours from anon, authenticated;
alter table public.opening_hours enable row level security;

-- How long before closing the last appointment starts ("the last
-- appointment of the day starts one hour before closing"): a request later
-- than that is refused like one when the business is closed.
alter table public.businesses
  add column last_start_before_close smallint not null default 0 check (last_start_before_close between 0 and 240);

-- The admin saves the whole week at once: the business's rows are replaced
-- in one transaction, with the last-start setting. Overlaps are refused by
-- the app (hours-rows.ts), which explains them per row.
create or replace function public.replace_opening_hours(p_business_id uuid, p_hours jsonb, p_last_start_before_close int)
returns int
language plpgsql
set search_path = ''
as $$
begin
  if jsonb_typeof(p_hours) <> 'array' or jsonb_array_length(p_hours) > 28 then
    raise exception 'invalid_hours' using errcode = 'P0001';
  end if;
  update public.businesses set last_start_before_close = p_last_start_before_close where id = p_business_id;
  delete from public.opening_hours where business_id = p_business_id;
  insert into public.opening_hours (business_id, day, opens, closes)
  select p_business_id, (e ->> 'day')::smallint, (e ->> 'opens')::time, (e ->> 'closes')::time
    from jsonb_array_elements(p_hours) as e;
  return jsonb_array_length(p_hours);
end;
$$;

revoke execute on function public.replace_opening_hours(uuid, jsonb, int) from public, anon, authenticated;
