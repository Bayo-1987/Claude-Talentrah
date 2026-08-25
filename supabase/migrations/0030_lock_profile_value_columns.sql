-- 0030 — Stop a user granting themselves credits, free trials, and referrals.
--
-- The generalisation of 0028, applied to the rest of the schema. 0028 fixed
-- one column on one table; this is the systematic pass that should have
-- followed it, and it found a worse instance.
--
-- `profiles` has "profiles are self-updatable" FOR UPDATE, scoped to
-- auth.uid() = id. The row being yours does not make every column on it yours
-- to set, and nothing restricted which columns that policy could touch.
-- Measured against the live project with a real authenticated session:
--
--   update profiles set credits_balance = 999999      -> NO ERROR, balance = 999999
--   update profiles set free_trial_tailoring_used=false -> NO ERROR, trial restored
--   update profiles set referral_code = 'HACKED99'    -> NO ERROR
--   update profiles set referred_by = <other user>    -> NO ERROR
--
-- The first one is the serious one, and it is not cosmetic. `credits_balance`
-- is what src/lib/credits/spend.ts reads to decide whether a paid AI action
-- can proceed:
--
--     const currentBalance = profile?.credits_balance ?? 0;
--     if (currentBalance < amount) throw new InsufficientCreditsError(...)
--
-- so setting it directly buys unlimited tailoring, cover letters and bullet
-- rewrites — real model spend, billed to the project, from one PATCH. The
-- schema comment on that column already said "kept in sync with credit_ledger
-- by a trigger... do not write to this column directly", which is exactly the
-- point: it was documented as a rule and enforced as nothing. `credit_ledger`
-- itself is correctly locked (no INSERT policy), so the ledger was never the
-- weak side — the cached balance the ledger writes INTO was.
--
-- `referral_code` and `referred_by` matter for a different reason: they are
-- the identity of the referral graph. Rewriting `referred_by` retroactively
-- attributes an existing account to a referrer of your choosing.
--
-- Same mechanism and same ordering trap as 0028: a table-level UPDATE grant
-- overrides a column-level revoke, and Supabase grants ALL ON ALL TABLES to
-- authenticated by default, so the table grant has to come off before the
-- per-column grants go back on.
--
-- What stays writable is what a person legitimately edits about themselves.
-- Nothing in the app writes profiles through a user client today (the only
-- profiles UPDATE in the codebase is src/lib/tailoring/gate.ts, which uses the
-- service role), so this could have revoked UPDATE outright — these columns
-- are granted because the Settings screen in CLAUDE.md's IA will need them,
-- and a grant list that matches intent is easier to review later than a blanket
-- revoke someone widens in a hurry.
--
-- `market_segment` is deliberately NOT granted. It is inert today, but it is
-- the home/diaspora flag Phase 2 prices against, and a user self-selecting
-- their own billing segment is the same shape of bug as this migration. Grant
-- it when there is a real reason to, not pre-emptively.

revoke update on public.profiles from anon, authenticated;

grant update (first_name, last_name, country, locale, updated_at)
  on public.profiles
  to authenticated;
