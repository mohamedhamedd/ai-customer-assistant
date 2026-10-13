-- The services customers can request a consultation for, as the business
-- names them: the assistant's create_consultation_request accepts only
-- these, exactly ("braces" is requested as "Traditional braces (full
-- treatment)"), so staff get consistent requests. Empty: any service, as
-- before. Set in the admin settings, one per line.
--
-- Additive: a constant default (no table rewrite), and a check every row
-- already passes. Each name's length is checked by the app (like the
-- service on a request, at most 120 characters).
alter table public.businesses
  add column consultation_services text[] not null default '{}',
  add constraint businesses_consultation_services_count check (cardinality(consultation_services) <= 50);
