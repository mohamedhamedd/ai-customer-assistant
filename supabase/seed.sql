-- Demo business. Documents are loaded separately by the ingestion script,
-- because they need embeddings (OpenAI API). Re-runnable.
-- Its assistant guidelines are the clinic's own rules (the shared prompt
-- has no business-specific ones). Its consultation services are named as in
-- its price list, so requests match what staff see there.
insert into public.businesses (slug, name, description, timezone, assistant_guidelines, consultation_services)
values (
  'lakeside-dental',
  'Lakeside Dental Clinic',
  'A family dental clinic offering general, cosmetic and orthodontic care.',
  'America/Los_Angeles',
  E'Never give a diagnosis or medical advice, and don''t say whether a treatment is right for someone: suggest a consultation instead.\nIf someone describes a dental emergency (severe swelling that affects breathing or swallowing, heavy bleeding, a serious injury), tell them to call 911 or go to the nearest emergency room now.',
  array[
    'Routine check-up and cleaning',
    'New patient exam with full X-rays',
    'Child check-up and cleaning (under 13)',
    'Composite filling',
    'Porcelain crown',
    'Root canal',
    'Simple extraction',
    'In-office teeth whitening (single session)',
    'Take-home whitening kit (custom trays and gel)',
    'Composite bonding',
    'Porcelain veneer',
    'Invisalign or orthodontic consultation',
    'Invisalign (full treatment)',
    'Traditional braces (full treatment)',
    'Dental implant consultation'
  ]
)
on conflict (slug) do update
  set name = excluded.name,
      description = excluded.description,
      timezone = excluded.timezone,
      assistant_guidelines = excluded.assistant_guidelines,
      consultation_services = excluded.consultation_services;
