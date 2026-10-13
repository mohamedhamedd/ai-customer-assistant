-- A business's opening hours, as a table (step 3 of structured knowledge):
-- one row per time range, so a day with a lunch break has two rows and a
-- closed day has none. Times are the business's local time (its timezone).
-- A consultation request for a time the business is closed is refused in
-- code (src/lib/agent/tools.ts), instead of trusting the model to check.
-- A range can apply to some weeks of the month only ("1st and 3rd
-- Saturday"), and dates can be closed (closed_dates: holidays); both are
-- checked in code too. Anything else ("seasonal hours in summer") goes in
-- the business's hours notes, which the assistant reads with the hours.
create table public.opening_hours (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  -- ISO weekday: 1 = Monday ... 7 = Sunday.
  day         smallint not null check (day between 1 and 7),
  opens       time not null,
  -- 00:00 closes at midnight.
  closes      time not null,
  -- Which of its weekday in the month: 1 to 5, -1 for the last. Empty:
  -- every week.
  weeks       smallint[] not null default '{}' check (weeks <@ '{1,2,3,4,5,-1}'::smallint[]),
  created_at  timestamptz not null default now(),
  check (closes > opens or closes = '00:00'),
  unique (business_id, day, opens, weeks)
);

-- Days the business is closed whatever the weekday's hours (holidays), in
-- its local dates.
create table public.closed_dates (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  date        date not null,
  label       text not null default '' check (char_length(label) <= 80),
  created_at  timestamptz not null default now(),
  unique (business_id, date)
);

revoke all on public.closed_dates from anon, authenticated;
alter table public.closed_dates enable row level security;

revoke all on public.opening_hours from anon, authenticated;
alter table public.opening_hours enable row level security;

-- How long before closing the last appointment starts ("the last
-- appointment of the day starts one hour before closing"): a request later
-- than that is refused like one when the business is closed.
alter table public.businesses
  add column last_start_before_close smallint not null default 0 check (last_start_before_close between 0 and 240),
  -- Exceptions in staff's words: "Saturdays: first and third of the month
  -- only. Closed on major US public holidays."
  add column hours_notes text not null default '' check (char_length(hours_notes) <= 500);

-- The admin saves the whole week at once: the business's rows are replaced
-- in one transaction, with the last-start setting, the notes and the closed
-- dates. Overlaps are refused by
-- the app (hours-rows.ts), which explains them per row.
create or replace function public.replace_opening_hours(p_business_id uuid, p_hours jsonb, p_last_start_before_close int, p_notes text, p_closed jsonb)
returns int
language plpgsql
set search_path = ''
as $$
begin
  if jsonb_typeof(p_hours) <> 'array' or jsonb_array_length(p_hours) > 28
     or jsonb_typeof(p_closed) <> 'array' or jsonb_array_length(p_closed) > 100 then
    raise exception 'invalid_hours' using errcode = 'P0001';
  end if;
  update public.businesses set last_start_before_close = p_last_start_before_close, hours_notes = btrim(p_notes) where id = p_business_id;
  delete from public.opening_hours where business_id = p_business_id;
  insert into public.opening_hours (business_id, day, opens, closes, weeks)
  select p_business_id, (e ->> 'day')::smallint, (e ->> 'opens')::time, (e ->> 'closes')::time,
         coalesce(array(select w::smallint from jsonb_array_elements_text(e -> 'weeks') as w), '{}')
    from jsonb_array_elements(p_hours) as e;
  delete from public.closed_dates where business_id = p_business_id;
  insert into public.closed_dates (business_id, date, label)
  select p_business_id, (c ->> 'date')::date, coalesce(btrim(c ->> 'label'), '')
    from jsonb_array_elements(p_closed) as c;
  return jsonb_array_length(p_hours);
end;
$$;

revoke execute on function public.replace_opening_hours(uuid, jsonb, int, text, jsonb) from public, anon, authenticated;
