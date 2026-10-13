-- Simpler guards, step 2 of 2: what only the old guards used (PR-16).
-- Apply once no server runs the previous code: it reads these.
--
-- flags held what the input guard blocked and the answers its checks
-- replaced, with embeddings the input guard learned from. The input guard,
-- the scope check and the learning are gone; a replaced answer is now kept
-- on the message itself (replaced_original, replaced_reason).
drop function public.clone_business_for_eval(uuid, text);
drop function public.similar_flags(uuid, extensions.vector, int);
drop table public.flags;

-- Replaced by admin_conversation_list (has_issue, issues-only filter).
drop function public.admin_conversations(uuid, int);
