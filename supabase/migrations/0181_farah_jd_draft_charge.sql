-- 0181 — send-368: "Draft with Farah" — an opt-in, paid, AI-generated job
-- description + suggested fields, drafted from just the job title (plus
-- whatever else is already on the form when clicked). Same wallet, same
-- atomic debit-before-generate shape 0176 already established for "Let
-- Farah screen this for you."
--
-- NOTE ON NUMBERING: the founder's own request text said "migration 0180" —
-- checked directly against this project's real migration history before
-- writing this, not assumed, and 0180 was already consumed by an unrelated,
-- separately in-progress fix (0180_trigger_search_path_hardening, send-374,
-- applied to dev but not yet committed to this repo at the time this was
-- written). This migration is 0181 instead, so the two don't collide.
--
-- ── WHY THIS HAS NO DEDICATED SQL WRAPPER FUNCTION, UNLIKE 0176's
--    record_farah_screening_review ───────────────────────────────────────
--
-- record_farah_screening_review exists because that feature has a downstream
-- row (application_screening_answers) to annotate atomically alongside the
-- charge. This feature's output lands straight into the create/edit form and
-- the transaction is done — there is no row to write once the LLM call
-- returns. So the Server Action layer calls debit_ad_wallet/credit_ad_wallet
-- directly (see src/lib/employer/draft-job-action.ts): debit first, generate
-- second, credit back (reason 'reversal', the same reason 0043's own
-- indeterminate-renewal-retry logic already uses for an undone charge) only
-- if generation throws.
--
-- This migration adds no table, no trigger, no function — a single new enum
-- value and an updated comment on the enum itself.

alter type public.ad_wallet_reason add value 'farah_jd_draft_charge';

comment on type public.ad_wallet_reason is
  'debit reasons: campaign_charge (0046/0047 ad campaigns), farah_screening_charge (0176 — per-answer AI screening review), farah_jd_draft_charge (send-368 — per-draft AI job-scoping generation); credit reasons: topup, admin_adjustment, reversal.';
