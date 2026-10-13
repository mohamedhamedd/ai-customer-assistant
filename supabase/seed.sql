-- Demo business. Documents are loaded separately by the ingestion script,
-- because they need embeddings (OpenAI API). Re-runnable.
-- Its assistant guidelines are the clinic's own rules (the shared prompt
-- has no business-specific ones). Its consultation services are suggested
-- from its documents when they are loaded (npm run ingest).
insert into public.businesses (slug, name, description, timezone, assistant_guidelines)
values (
  'lakeside-dental',
  'Lakeside Dental Clinic',
  'A family dental clinic offering general, cosmetic and orthodontic care.',
  'America/Los_Angeles',
  E'Never give a diagnosis or medical advice, and don''t say whether a treatment is right for someone: suggest a consultation instead.\nIf someone describes a dental emergency (severe swelling that affects breathing or swallowing, heavy bleeding, a serious injury), tell them to call 911 or go to the nearest emergency room now.'
)
on conflict (slug) do update
  set name = excluded.name,
      description = excluded.description,
      timezone = excluded.timezone,
      assistant_guidelines = excluded.assistant_guidelines;
