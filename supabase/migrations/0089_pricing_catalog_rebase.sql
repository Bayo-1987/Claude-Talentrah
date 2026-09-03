-- 0089 — founder-decided repricing (2026-09-03), catalog side.
--
-- Anchor: ₦2,500 = one CV tailoring. Starter is 20 credits at ₦2,500, so a
-- credit is ₦125 (see 0090's sibling change to src/lib/credits/costs.ts for
-- the per-action rebase this anchor drives).
--
-- Retire Popular and Power by DEACTIVATING, never deleting.
-- payment_transactions and purchase-history rows referencing them by
-- product_id must still resolve and render — and they do without any
-- special-casing, because src/app/(app)/billing/page.tsx's purchase-history
-- list reads amount/product_type/channel/reference straight off the
-- payment_transactions row itself and never joins back to credit_packs; the
-- billing page's BUY grid is the only reader that filters is_active = true,
-- so deactivating removes them from sale without touching anything that
-- already happened. Deleting the rows would break the actual FK from
-- payment_transactions.product_id instead.
update public.credit_packs set is_active = false where name in ('Popular', 'Power');

-- Plus, replacing Popular: 45 = one Talent Directory verification (25,
-- Phase 3 — priced now so the credit's value is legible today even though
-- the feature isn't live yet) + one tailoring (20) exactly.
insert into public.credit_packs (name, credits, price_ngn, is_active)
values ('Plus', 45, 5000, true)
on conflict (name) do update set credits = excluded.credits, price_ngn = excluded.price_ngn, is_active = true;

-- Starter's price is unchanged (₦2,500) — now equal to exactly one
-- tailoring run at the new rate, which is the point of the anchor. Ensure
-- it stays active/correct regardless of what a prior run of this migration
-- (or a hand edit) left it as.
update public.credit_packs set price_ngn = 2500, credits = 20, is_active = true where name = 'Starter';

-- 7-Day Sprint Pass: ₦2,000 -> ₦4,000.
update public.passes set price_ngn = 4000 where name = '7-Day Sprint Pass';

-- 30-Day Pass: price unchanged, restated so this migration is a complete
-- record of the post-rebase catalog on its own.
update public.passes set price_ngn = 6500 where name = '30-Day Pass';

-- 90-Day Pass: new.
insert into public.passes (name, duration_days, price_ngn, is_active)
values ('90-Day Pass', 90, 15000, true)
on conflict (name) do update set duration_days = excluded.duration_days, price_ngn = excluded.price_ngn, is_active = true;
