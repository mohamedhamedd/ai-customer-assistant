-- Business profile (PR-15, US-10.1, US-10.2).
--
-- 1. Assistant guidelines: rules one business sets for its assistant
--    ("never give a diagnosis"). They used to be written into the shared
--    prompt, which made every business a dental clinic. Now the shared
--    prompt is neutral and each business brings its own rules.
-- 2. The profile's limits, enforced here as well as in the admin form, so a
--    row can't be longer than the form allows whoever writes it. The slug
--    rule is the one the chat URL uses (src/lib/chat/limits.ts).
--
-- Additive: a constant default (no rewrite) and checks that every existing
-- row already satisfies.

alter table public.businesses
  add column assistant_guidelines text not null default '',
  add constraint businesses_name_length        check (char_length(btrim(name)) between 1 and 100),
  add constraint businesses_description_length check (char_length(description) <= 500),
  add constraint businesses_guidelines_length  check (char_length(assistant_guidelines) <= 2000),
  add constraint businesses_slug_format        check (char_length(slug) <= 64 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- The demo clinic's rules, which this migration takes out of the shared
-- prompt. Set here too (not only in seed.sql) so a database that is migrated
-- rather than reset keeps them; only if nobody has written guidelines yet.
update public.businesses
   set assistant_guidelines = E'Never give a diagnosis or medical advice, and don''t say whether a treatment is right for someone: suggest a consultation instead.\nIf someone describes a dental emergency (severe swelling that affects breathing or swallowing, heavy bleeding, a serious injury), tell them to call 911 or go to the nearest emergency room now.'
 where slug = 'lakeside-dental' and assistant_guidelines = '';
