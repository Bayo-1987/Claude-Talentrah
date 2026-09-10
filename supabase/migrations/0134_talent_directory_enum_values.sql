-- 0134 — two new enum values for Talent Directory & Verification v1
-- (send-139, build-prompt §6.13). ONE STATEMENT EACH, NOTHING ELSE, in their
-- own migration: Postgres forbids using a new enum value in the same
-- transaction that adds it (`55P04 unsafe use of new value`) — see
-- 0049/0116/0118/0132 for the identical pattern already established four
-- times in this repo for exactly these two enums.
--
-- `talent_directory_verification`: the credit-gated cost of AI-graded skills
-- verification (25 credits, per send-139), spent through the existing
-- `spend_credits_atomic` (0035) — no new atomicity primitive needed, this is
-- just a new reason the existing one already supports once the value exists.
--
-- `talent_directory_subscription`: a FOURTH kind of thing
-- `payment_transactions` can describe, following 0050's own precedent for
-- `ad_wallet_topup` and 0132's for `mentor_session` — a fixed-price,
-- fixed-date recharge (the Pass shape, per docs/employer-billing-plan.md's
-- own "looks reusable, is not" section on why ad-wallet's consumption model
-- doesn't fit a subscription), not a credits action or a per-use charge. The
-- CHECK constraint that makes this shape honest (product_id required) lands
-- in 0135, once this value can actually be used.

alter type public.credit_reason add value if not exists 'talent_directory_verification';
alter type public.payment_product_type add value if not exists 'talent_directory_subscription';
