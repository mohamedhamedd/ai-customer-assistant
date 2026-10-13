-- The demo businesses, as staff would set them up in the admin: profile and
-- rules, services table and opening hours. Lakeside Dental Clinic first, then
-- Maple Street Hair Studio. No customers, conversations or requests: the
-- admin starts empty.
--
-- Its documents (services explained, insurance, location, policies, FAQ) need
-- embeddings, so they're loaded after the reset by the ingestion script:
--   npm run ingest -- ./data/sample-clinic
--
-- Each fact lives in one place: names, prices, durations and hours here;
-- everything descriptive in the documents.

-- 1. The business (Admin > Settings).
insert into public.businesses (slug, name, description, timezone, assistant_guidelines)
values (
  'lakeside-dental',
  'Lakeside Dental Clinic',
  'A family dental clinic offering general, cosmetic and orthodontic care.',
  'America/Los_Angeles',
  E'Never give a diagnosis or medical advice, and don''t say whether a treatment is right for someone: suggest a consultation instead.\n'
  'If someone describes a dental emergency (severe swelling that affects breathing or swallowing, heavy bleeding, a serious injury), tell them to call 911 or go to the nearest emergency room now.'
);

-- 2. Services (Admin > Services). The assistant quotes them as written and
-- only lets customers request the ones marked requestable.
select public.replace_services(
  (select id from public.businesses where slug = 'lakeside-dental'),
  $json$[
  {"name": "Routine check-up and cleaning",                     "category": "Exams and cleanings",   "price": "$129",              "duration": "45 minutes",                        "description": "", "requestable": true},
  {"name": "New patient exam with full X-rays",                 "category": "Exams and cleanings",   "price": "$189",              "duration": "60 minutes",                        "description": "", "requestable": true},
  {"name": "Emergency exam (same-day)",                         "category": "Exams and cleanings",   "price": "$95",               "duration": "",                                  "description": "", "requestable": true},
  {"name": "Child check-up and cleaning (under 13)",            "category": "Exams and cleanings",   "price": "$89",               "duration": "",                                  "description": "", "requestable": true},
  {"name": "Fluoride treatment",                                "category": "Exams and cleanings",   "price": "$35",               "duration": "",                                  "description": "", "requestable": true},
  {"name": "Sealants (per tooth)",                              "category": "Exams and cleanings",   "price": "$45",               "duration": "",                                  "description": "", "requestable": true},
  {"name": "Composite filling (one surface)",                   "category": "Restorative treatment", "price": "$150",              "duration": "30 to 60 minutes",                  "description": "", "requestable": true},
  {"name": "Composite filling (two or more surfaces)",          "category": "Restorative treatment", "price": "$225 to $300",      "duration": "30 to 60 minutes",                  "description": "", "requestable": true},
  {"name": "Porcelain crown",                                   "category": "Restorative treatment", "price": "$1,100",            "duration": "2 visits, about 2 weeks apart",     "description": "", "requestable": true},
  {"name": "Root canal (front tooth)",                          "category": "Restorative treatment", "price": "$750",              "duration": "1 or 2 visits of about 90 minutes", "description": "", "requestable": true},
  {"name": "Root canal (molar)",                                "category": "Restorative treatment", "price": "$1,050",            "duration": "1 or 2 visits of about 90 minutes", "description": "", "requestable": true},
  {"name": "Simple extraction",                                 "category": "Restorative treatment", "price": "$185",              "duration": "",                                  "description": "", "requestable": true},
  {"name": "In-office teeth whitening (single session)",        "category": "Cosmetic treatment",    "price": "$349",              "duration": "60 to 90 minutes",                  "description": "", "requestable": true},
  {"name": "Take-home whitening kit (custom trays and gel)",    "category": "Cosmetic treatment",    "price": "$199",              "duration": "About 2 weeks, 30 minutes a day",   "description": "", "requestable": true},
  {"name": "Whitening touch-up gel (refill)",                   "category": "Cosmetic treatment",    "price": "$45",               "duration": "",                                  "description": "", "requestable": false},
  {"name": "Composite bonding (per tooth)",                     "category": "Cosmetic treatment",    "price": "$250",              "duration": "30 to 60 minutes per tooth",        "description": "", "requestable": true},
  {"name": "Porcelain veneer (per tooth)",                      "category": "Cosmetic treatment",    "price": "$1,250",            "duration": "2 visits",                          "description": "", "requestable": true},
  {"name": "Invisalign or orthodontic consultation (20 minutes)", "category": "Orthodontics",        "price": "Free",              "duration": "20 minutes",                        "description": "", "requestable": true},
  {"name": "Invisalign (full treatment)",                       "category": "Orthodontics",          "price": "$3,500 to $5,500",  "duration": "6 to 18 months",                    "description": "", "requestable": true},
  {"name": "Traditional braces (full treatment)",               "category": "Orthodontics",          "price": "$4,000 to $6,000",  "duration": "18 to 24 months",                   "description": "", "requestable": true},
  {"name": "Retainers (per set)",                               "category": "Orthodontics",          "price": "$275",              "duration": "",                                  "description": "", "requestable": true}
]$json$::jsonb
);

-- 3. Opening hours (Admin > Opening hours): Mon–Thu 8–5, Fri 8–2, Sat 9–1,
-- closed Sunday; the last appointment starts an hour before closing; a note
-- for what the ranges can't say; and the holidays it's closed.
select public.replace_opening_hours(
  (select id from public.businesses where slug = 'lakeside-dental'),
  $json$[
  {"day": 1, "opens": "08:00", "closes": "17:00"},
  {"day": 2, "opens": "08:00", "closes": "17:00"},
  {"day": 3, "opens": "08:00", "closes": "17:00"},
  {"day": 4, "opens": "08:00", "closes": "17:00"},
  {"day": 5, "opens": "08:00", "closes": "14:00"},
  {"day": 6, "opens": "09:00", "closes": "13:00"}
]$json$::jsonb,
  60,
  'Saturdays: first and third Saturday of the month only. Holiday closures are posted on our front door and voicemail two weeks in advance.',
  $json$[
  {"date": "2026-11-26", "label": "Thanksgiving"},
  {"date": "2026-12-25", "label": "Christmas Day"},
  {"date": "2027-01-01", "label": "New Year's Day"}
]$json$::jsonb
);

-- ---------------------------------------------------------------------------
-- A second business, Maple Street Hair Studio: a very different industry,
-- timezone and set of rules, to test the same assistant on. Its documents:
--   npm run ingest -- ./data/sample-salon --business maple-street-hair

insert into public.businesses (slug, name, description, timezone, assistant_guidelines)
values (
  'maple-street-hair',
  'Maple Street Hair Studio',
  'An independent hair salon for cuts, colour, treatments and special-occasion styling, with specialists in curly and textured hair.',
  'America/New_York',
  E'Don''t say whether a colour, cut or treatment will suit someone, or is safe for their hair or scalp: suggest the free colour consultation instead. Never promise an exact shade or result.\n'
  'When someone asks for a colour service, mention that a patch test is needed at least 48 hours before if it''s their first colour with us or they have reacted to hair dye before.'
);

select public.replace_services(
  (select id from public.businesses where slug = 'maple-street-hair'),
  $json$[
  {"name": "Women's cut and style",              "category": "Cuts and styling",   "price": "$65",           "duration": "60 minutes",       "description": "", "requestable": true},
  {"name": "Men's cut",                          "category": "Cuts and styling",   "price": "$40",           "duration": "30 minutes",       "description": "", "requestable": true},
  {"name": "Children's cut (under 12)",          "category": "Cuts and styling",   "price": "$28",           "duration": "30 minutes",       "description": "", "requestable": true},
  {"name": "Blow-dry and style",                 "category": "Cuts and styling",   "price": "$45",           "duration": "45 minutes",       "description": "", "requestable": true},
  {"name": "Fringe trim (walk-in only)",         "category": "Cuts and styling",   "price": "$10",           "duration": "15 minutes",       "description": "", "requestable": false},
  {"name": "Root touch-up",                      "category": "Colour",             "price": "$85",           "duration": "90 minutes",       "description": "", "requestable": true},
  {"name": "Full colour",                        "category": "Colour",             "price": "$120",          "duration": "2 hours",          "description": "", "requestable": true},
  {"name": "Partial highlights",                 "category": "Colour",             "price": "$140",          "duration": "2 hours",          "description": "", "requestable": true},
  {"name": "Full highlights",                    "category": "Colour",             "price": "$190",          "duration": "3 hours",          "description": "", "requestable": true},
  {"name": "Balayage",                           "category": "Colour",             "price": "$220 to $280",  "duration": "3 to 4 hours",     "description": "", "requestable": true},
  {"name": "Toner and gloss",                    "category": "Colour",             "price": "$45",           "duration": "30 minutes",       "description": "", "requestable": true},
  {"name": "Colour consultation (15 minutes)",   "category": "Colour",             "price": "Free",          "duration": "15 minutes",       "description": "", "requestable": true},
  {"name": "Deep conditioning treatment",        "category": "Treatments",         "price": "$35",           "duration": "20 minutes",       "description": "", "requestable": true},
  {"name": "Keratin smoothing treatment",        "category": "Treatments",         "price": "$250 to $350",  "duration": "About 3 hours",    "description": "", "requestable": true},
  {"name": "Updo",                               "category": "Special occasions",  "price": "$75",           "duration": "60 minutes",       "description": "", "requestable": true},
  {"name": "Bridal hair trial",                  "category": "Special occasions",  "price": "$95",           "duration": "90 minutes",       "description": "", "requestable": true},
  {"name": "Wedding day styling",                "category": "Special occasions",  "price": "Quoted per wedding", "duration": "",           "description": "", "requestable": true}
]$json$::jsonb
);

-- Tue, Wed, Fri 9–7, Thu 9–8, Sat 8–4; closed Sunday and Monday. The last
-- appointment starts 30 minutes before closing.
select public.replace_opening_hours(
  (select id from public.businesses where slug = 'maple-street-hair'),
  $json$[
  {"day": 2, "opens": "09:00", "closes": "19:00"},
  {"day": 3, "opens": "09:00", "closes": "19:00"},
  {"day": 4, "opens": "09:00", "closes": "20:00"},
  {"day": 5, "opens": "09:00", "closes": "19:00"},
  {"day": 6, "opens": "08:00", "closes": "16:00"}
]$json$::jsonb,
  30,
  'Walk-ins are welcome for men''s cuts and fringe trims when a stylist is free.',
  $json$[
  {"date": "2026-11-26", "label": "Thanksgiving"},
  {"date": "2026-12-24", "label": "Christmas Eve"},
  {"date": "2026-12-25", "label": "Christmas Day"},
  {"date": "2027-01-01", "label": "New Year's Day"}
]$json$::jsonb
);
