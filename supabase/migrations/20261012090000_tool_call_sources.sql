-- Citations a tool call produced (search_knowledge), kept with the call.
--
-- Voice answers are reported by the browser (design §3.5), so the server
-- can't take their citations or action cards from the browser without
-- trusting it. Instead, when a voice answer is stored, the server copies
-- them from the tool calls it ran itself since the previous message. That
-- needs the citations here; action cards are derived from `result`.
--
-- Additive with a constant default: no rewrite, no long lock.
alter table public.tool_calls
  add column sources jsonb not null default '[]'::jsonb;
