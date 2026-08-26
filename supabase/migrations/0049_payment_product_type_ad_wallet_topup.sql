-- 0049 — a third payment product type: topping up an organisation's ad wallet.
--
-- Split from 0050 deliberately. Postgres allows ALTER TYPE ... ADD VALUE inside
-- a transaction, but the new label cannot be USED in that same transaction —
-- and 0050's CHECK constraints reference it by literal. Combining them fails
-- with "unsafe use of new value of enum type", which reads like a syntax
-- problem and is not.

alter type public.payment_product_type add value if not exists 'ad_wallet_topup';
