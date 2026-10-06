-- 0238 rollback: remove the AI-review attempt limit. Drops both functions and the flag_source column (with its check). The column's contents are lost: after this, flagged attempts are no longer distinguishable from other rejected
-- AI reviews, and the code that calls the functions must be rolled back first or it will fail. Run only on the owner's separate approval.
drop function if exists public.claim_ai_talent_verification(uuid);
drop function if exists public.resolve_flagged_talent_verification(uuid, uuid, text, text);
alter table public.talent_verifications drop constraint if exists talent_verifications_flag_source_check;
alter table public.talent_verifications drop column if exists flag_source;
