-- Demo business, with its services and opening hours. Documents are loaded
-- separately by the ingestion script, because they need embeddings (OpenAI
-- API). Re-runnable.
-- Its assistant guidelines are the clinic's own rules (the shared prompt
-- has no business-specific ones).
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

-- Its services and opening hours (Admin > Services, Admin > Opening hours):
-- the exact facts (names, prices, durations, hours, closed dates), kept out
-- of the documents so each fact lives in one place. Replaced on every run.
select public.replace_services(
  (select id from public.businesses where slug = 'lakeside-dental'),
  $json$[
  {"name": "Routine check-up and cleaning", "category": "Exams and cleanings", "price": "$129", "duration": "45 minutes", "description": "", "requestable": true},
  {"name": "New patient exam with full X-rays", "category": "Exams and cleanings", "price": "$189", "duration": "60 minutes", "description": "", "requestable": true},
  {"name": "Emergency exam (same-day)", "category": "Exams and cleanings", "price": "$95", "duration": "", "description": "", "requestable": true},
  {"name": "Child check-up and cleaning (under 13)", "category": "Exams and cleanings", "price": "$89", "duration": "", "description": "", "requestable": true},
  {"name": "Fluoride treatment", "category": "Exams and cleanings", "price": "$35", "duration": "", "description": "", "requestable": true},
  {"name": "Sealants (per tooth)", "category": "Exams and cleanings", "price": "$45", "duration": "", "description": "", "requestable": true},
  {"name": "Composite filling (one surface)", "category": "Restorative treatment", "price": "$150", "duration": "30 to 60 minutes", "description": "", "requestable": true},
  {"name": "Composite filling (two or more surfaces)", "category": "Restorative treatment", "price": "$225 to $300", "duration": "30 to 60 minutes", "description": "", "requestable": true},
  {"name": "Porcelain crown", "category": "Restorative treatment", "price": "$1,100", "duration": "2 visits, about 2 weeks apart", "description": "", "requestable": true},
  {"name": "Root canal (front tooth)", "category": "Restorative treatment", "price": "$750", "duration": "1 or 2 visits of about 90 minutes", "description": "", "requestable": true},
  {"name": "Root canal (molar)", "category": "Restorative treatment", "price": "$1,050", "duration": "1 or 2 visits of about 90 minutes", "description": "", "requestable": true},
  {"name": "Simple extraction", "category": "Restorative treatment", "price": "$185", "duration": "", "description": "", "requestable": true},
  {"name": "In-office teeth whitening (single session)", "category": "Cosmetic treatment", "price": "$349", "duration": "60 to 90 minutes", "description": "", "requestable": true},
  {"name": "Take-home whitening kit (custom trays and gel)", "category": "Cosmetic treatment", "price": "$199", "duration": "About 2 weeks, 30 minutes a day", "description": "", "requestable": true},
  {"name": "Whitening touch-up gel (refill)", "category": "Cosmetic treatment", "price": "$45", "duration": "", "description": "", "requestable": false},
  {"name": "Composite bonding (per tooth)", "category": "Cosmetic treatment", "price": "$250", "duration": "30 to 60 minutes per tooth", "description": "", "requestable": true},
  {"name": "Porcelain veneer (per tooth)", "category": "Cosmetic treatment", "price": "$1,250", "duration": "2 visits", "description": "", "requestable": true},
  {"name": "Invisalign or orthodontic consultation (20 minutes)", "category": "Orthodontics", "price": "Free", "duration": "20 minutes", "description": "", "requestable": true},
  {"name": "Invisalign (full treatment)", "category": "Orthodontics", "price": "$3,500 to $5,500", "duration": "6 to 18 months", "description": "", "requestable": true},
  {"name": "Traditional braces (full treatment)", "category": "Orthodontics", "price": "$4,000 to $6,000", "duration": "18 to 24 months", "description": "", "requestable": true},
  {"name": "Retainers (per set)", "category": "Orthodontics", "price": "$275", "duration": "", "description": "", "requestable": true}
]$json$::jsonb
);

select public.replace_opening_hours(
  (select id from public.businesses where slug = 'lakeside-dental'),
  $json$[{"day": 1, "opens": "08:00", "closes": "17:00"}, {"day": 2, "opens": "08:00", "closes": "17:00"}, {"day": 3, "opens": "08:00", "closes": "17:00"}, {"day": 4, "opens": "08:00", "closes": "17:00"}, {"day": 5, "opens": "08:00", "closes": "14:00"}, {"day": 6, "opens": "09:00", "closes": "13:00"}]$json$::jsonb,
  60,
  'Saturdays: first and third Saturday of the month only. Holiday closures are posted on our front door and voicemail two weeks in advance.',
  $json$[{"date": "2026-11-26", "label": "Thanksgiving"}, {"date": "2026-12-25", "label": "Christmas Day"}, {"date": "2027-01-01", "label": "New Year's Day"}]$json$::jsonb
);
