-- 0169 — founder-decided Pass repricing (2026-09-17).
--
-- Repositions Passes from a mainstream cheaper-than-credits alternative
-- toward a premium/heavy-usage product — see the pricing proposal
-- (claude.ai/artifact/FHcjtZW7852hgN5VupM8XH) for the full breakeven
-- analysis. Already applied directly to production (nytwbbzfpytctjsoczzq)
-- via the Supabase connector as a one-off data fix before this migration
-- was written — restated here, idempotently, so dozaffzgqkbarxtlclsj and
-- any from-scratch replay land on the same values, and so this change has
-- the same durable, reviewable record every prior catalog change has.

update public.passes set price_ngn = 6500 where name = '7-Day Sprint Pass';
update public.passes set price_ngn = 13500 where name = '30-Day Pass';
update public.passes set price_ngn = 30000 where name = '90-Day Pass';
