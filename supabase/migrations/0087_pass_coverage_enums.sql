-- 0087 — enum values for pass-covered credit gates.
--
-- Two additions, both additive (no existing row's meaning changes):
--
-- `credit_gate_outcome` gains 'covered_by_pass' alongside the existing
-- 'proceeded' / 'blocked_insufficient_credits'. Deliberately a THIRD value,
-- not a reuse of 'proceeded' with a flag column: the funnel's whole purpose
-- (see src/lib/credits/gate-events.ts's own header) is telling "this action
-- ran" apart from "this action ran, and cost the user nothing because a
-- Pass covered it" — the two answer different product questions, and folding
-- them into one value would make every read of this table have to guess
-- which world it was written from.
--
-- `credit_reason` gains 'pricing_rebase_4x', for the one-time credit_ledger
-- entry the balance migration (0090) writes when every existing balance is
-- multiplied by four. A real reason value, not 'admin_adjustment': the
-- rebase is a mechanical, scripted, one-time event with a specific cause
-- worth being able to filter for on its own, not an ad hoc correction.
alter type public.credit_gate_outcome add value if not exists 'covered_by_pass';
alter type public.credit_reason add value if not exists 'pricing_rebase_4x';
