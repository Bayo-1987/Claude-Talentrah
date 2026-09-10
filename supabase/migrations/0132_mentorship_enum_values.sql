-- 0132 — two new enum values for the Mentorship Marketplace v1 slice
-- (send-137, build-prompt §6.11). ONE STATEMENT EACH, NOTHING ELSE, in their
-- own migration: Postgres forbids using a new enum value in the same
-- transaction that adds it (`55P04 unsafe use of new value`) — see
-- 0077/0078's own header for the exact failure this avoids, and 0049/0116/
-- 0118 for the identical pattern already established twice in this repo for
-- exactly these two enums.
--
-- `mentor_session`: a THIRD kind of thing `payment_transactions` can
-- describe, following 0049's own precedent for `ad_wallet_topup` — a direct,
-- one-time Paystack charge, not a credits action (build-prompt §6.11 is
-- explicit mentor sessions are paid directly). The CHECK constraint that
-- makes this shape honest (product_id required, referencing the session
-- being paid for) lands in 0133, once this value can actually be used.
--
-- `mentor_review`: deciding whether a mentor application is publicly listed
-- is a trust decision over a NEW public-facing surface, not a plain content
-- area — the same shape as 0116 (`employer_verification`) and 0118
-- (`job_review`). Starts granted to nobody; an operator gets it deliberately
-- in /admin/operators. `admin_permission_catalog()` (0079) is
-- `unnest(enum_range(...))` and the Operators page's RoleEditor already
-- falls back to a humanised label for any key it doesn't recognise, so
-- nothing else needs to change for this to become grantable.

alter type public.payment_product_type add value if not exists 'mentor_session';
alter type public.admin_permission add value if not exists 'mentor_review';
