-- 0050 — make payment_transactions able to describe a wallet top-up honestly.
--
-- A top-up has no product row. `product_id` was NOT NULL, so the only ways to
-- record one were to invent a product or to stuff the organisation id into a
-- column that does not mean that. Both are lies that a later reader has to
-- discover; a nullable column with a constraint saying exactly when it may be
-- null is not.
--
-- The two CHECKs replace what NOT NULL was buying, per product type:
--   * credit_pack / pass still REQUIRE product_id — nothing is loosened for
--     the paths that already work.
--   * ad_wallet_topup requires organization_id instead, because that is the
--     thing being credited, and a top-up with no organisation is not a
--     top-up.
--
-- WHY paystack_reference IS NOT NULL FOR TOP-UPS AND ONLY TOP-UPS. It is the
-- idempotency key. `ad_wallet_ledger_topup_reference_idx` is UNIQUE on
-- `paystack_reference` WHERE paystack_reference IS NOT NULL — so a NULL
-- reference does not collide with anything and a duplicate webhook delivery
-- would credit the wallet twice, silently. The partial index cannot defend
-- itself against a null; this constraint is what makes that index actually
-- load-bearing.
--
-- This matters more here than for the other two product types because
-- fulfillPayment's "already processed" guard is a read-then-act check on
-- payment_transactions.status, and its own comment records that the
-- webhook/callback double-grant race is open and out of scope. For credit
-- packs and passes nothing closes it. For a wallet top-up, this constraint
-- plus that unique index does.

alter table public.payment_transactions
  alter column product_id drop not null;

alter table public.payment_transactions
  add constraint payment_transactions_product_id_required
  check (
    product_type not in ('credit_pack', 'pass') or product_id is not null
  );

alter table public.payment_transactions
  add constraint payment_transactions_topup_shape
  check (
    product_type <> 'ad_wallet_topup'
    or (organization_id is not null and paystack_reference is not null)
  );
