-- A business's services, as a table (step 1 of structured knowledge): the
-- exact name, category, price, duration and a short description, and
-- whether customers can request a consultation for it. Free-text documents
-- stay for everything else (FAQs, policies); these are the facts that must
-- be exact. Filled in the admin, from a CSV template, or suggested from the
-- business's documents.
--
-- Price and duration are text: businesses write ranges and words ("$4,000
-- to $6,000", "Free", "60 to 90 minutes"), and they are shown, not computed.
create table public.services (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  -- The order staff gave the list.
  position    int  not null,
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  category    text not null default '' check (char_length(category) <= 60),
  price       text not null default '' check (char_length(price) <= 60),
  duration    text not null default '' check (char_length(duration) <= 60),
  description text not null default '' check (char_length(description) <= 500),
  requestable boolean not null default true,
  created_at  timestamptz not null default now()
);

-- One service per name per business, ignoring case and outer spaces: the
-- name is what a consultation request is matched against.
create unique index services_business_name_idx on public.services (business_id, lower(btrim(name)));
create index services_business_position_idx on public.services (business_id, position);

revoke all on public.services from anon, authenticated;
alter table public.services enable row level security;

-- The admin edits the list as a table and saves it at once: the business's
-- rows are replaced in one transaction, in the order given. Nothing else
-- references a service row (a request keeps the name), so new ids are fine.
create or replace function public.replace_services(p_business_id uuid, p_services jsonb)
returns int
language plpgsql
set search_path = ''
as $$
begin
  if jsonb_typeof(p_services) <> 'array' or jsonb_array_length(p_services) > 200 then
    raise exception 'invalid_services' using errcode = 'P0001';
  end if;
  delete from public.services where business_id = p_business_id;
  insert into public.services (business_id, position, name, category, price, duration, description, requestable)
  select p_business_id,
         (e.ord - 1)::int,
         btrim(e.value ->> 'name'),
         coalesce(btrim(e.value ->> 'category'), ''),
         coalesce(btrim(e.value ->> 'price'), ''),
         coalesce(btrim(e.value ->> 'duration'), ''),
         coalesce(btrim(e.value ->> 'description'), ''),
         coalesce((e.value ->> 'requestable')::boolean, true)
    from jsonb_array_elements(p_services) with ordinality as e(value, ord);
  return jsonb_array_length(p_services);
end;
$$;

revoke execute on function public.replace_services(uuid, jsonb) from public, anon, authenticated;
