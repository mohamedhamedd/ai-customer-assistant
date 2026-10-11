-- Demo business. Documents are loaded separately by the ingestion script,
-- because they need embeddings (OpenAI API). Re-runnable.
insert into public.businesses (slug, name, description, timezone)
values (
  'lakeside-dental',
  'Lakeside Dental Clinic',
  'A family dental clinic offering general, cosmetic and orthodontic care.',
  'America/Los_Angeles'
)
on conflict (slug) do update
  set name = excluded.name,
      description = excluded.description,
      timezone = excluded.timezone;
