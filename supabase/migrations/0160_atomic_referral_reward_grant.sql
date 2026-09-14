-- 0160 — Make grant_referral_reward atomic (send-229, Medium).
--
-- NUMBERED AFTER 0159 DELIBERATELY, AND DEPENDS ON IT. This migration calls
-- grant_credits_atomic(), which 0159_atomic_fulfillment_credit_pack_pass.sql
-- creates. 0159 was open as its own PR (#399, send-228) when this was
-- written; `ls supabase/migrations/` on a fresh checkout of main shows 0158
-- as the highest committed number, which would ordinarily make 0159 "free" —
-- it is not, that PR has already claimed it. Numbered 0160 here specifically
-- to avoid colliding with in-flight work this session already knows about,
-- per this repo's own numbering-collision history (0033, 0035, 0045, 0060,
-- 0128, 0136, 0137, 0138, 0158 have all recurred). Merge order matters: this
-- migration must be applied AFTER 0159 (both files must already exist by the
-- time this one runs on a fresh rebuild) — if these two PRs ever land in the
-- opposite order, renumber at merge time the same way this repo always has.
--
-- ---------------------------------------------------------------------------
-- What was wrong
-- ---------------------------------------------------------------------------
-- src/lib/credits/spend.ts's grantCredits() had the same read-then-write race
-- 0035 fixed on the spend side — but grepping every application call site
-- (per this task's own instruction not to assume the audit's short list was
-- complete) found grantCredits() has NO live callers any more:
-- fulfill.ts's credit_pack branch, its only caller, was just fixed to call
-- fulfill_credit_pack_or_pass() directly instead (0159). Fixing grantCredits()
-- alone would have fixed a function nothing calls, and missed the real bug.
--
-- The actual mechanism behind referral payouts and the referral signup/
-- activation bonuses is a SEPARATE function, grant_referral_reward() (0015),
-- called from handle_new_user() (the signup bonus) and
-- check_and_activate_referral() (the activation bonus) — and it has the
-- identical shape of bug, inline in PL/pgSQL rather than in TypeScript:
--
--     select credits_balance into current_balance from profiles ...  -- read
--     new_balance := current_balance + p_amount                      -- JS/PL math
--     insert into credit_ledger (..., balance_after: new_balance)    -- write
--
-- with apply_credit_ledger_entry's trigger then performing its usual ABSOLUTE
-- overwrite of profiles.credits_balance from that computed value. Two
-- referral conversions crediting the same referrer close together — two
-- referred users completing signup or activating within the same window,
-- both entirely ordinary, not a hypothetical — read the same starting
-- balance, both pass (there is no rejection condition here, unlike a spend,
-- so both "succeed"), and one grant's credit_ledger row records a
-- balance_after that the other one's write then clobbers. No money leaves
-- the business here (ranked below send-228 for that reason), but a real
-- referral reward can be silently lost.
--
-- ---------------------------------------------------------------------------
-- The fix
-- ---------------------------------------------------------------------------
-- grant_referral_reward() now calls grant_credits_atomic() (0159) for the
-- balance/ledger half of its work — the exact same atomic RELATIVE update
-- spend_credits_atomic (0035) and fulfill_credit_pack_or_pass (0159) both
-- use, reused rather than a third copy of the same technique built here.
-- Its own two pieces of logic that are NOT shared with a plain grant — the
-- 30-day reward cap check, and incrementing referrals.reward_credits_referrer
-- — are untouched; the referrals-table increment was never racy on its own
-- (a relative UPDATE on one specific row, same as any other), only the
-- credits/ledger half was.
--
-- grantCredits() (src/lib/credits/spend.ts) is ALSO updated in this same PR
-- to call grant_credits_atomic() via RPC, so a function with no live callers
-- today still doesn't carry a known bug if something starts calling it
-- tomorrow — cheap to fix now that the same repo already reviewed this
-- exact class of bug, and cheaper than someone rediscovering it.

create or replace function public.grant_referral_reward(
  p_referral_id uuid,
  p_referrer_id uuid,
  p_amount integer,
  p_reason public.credit_reason
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.count_rewarded_referrals_last_30d(p_referrer_id, p_referral_id) >= 10 then
    return;
  end if;

  perform public.grant_credits_atomic(p_referrer_id, p_amount, p_reason, p_referral_id);

  update public.referrals
  set reward_credits_referrer = reward_credits_referrer + p_amount
  where id = p_referral_id;
end;
$$;

revoke all on function public.grant_referral_reward(uuid, uuid, integer, public.credit_reason) from public;
revoke all on function public.grant_referral_reward(uuid, uuid, integer, public.credit_reason) from anon;
revoke all on function public.grant_referral_reward(uuid, uuid, integer, public.credit_reason) from authenticated;
grant execute on function public.grant_referral_reward(uuid, uuid, integer, public.credit_reason) to service_role, postgres;
