-- 0090 — ×4 balance migration, non-negotiable per the founder's rebase.
--
-- WHY ×4, AND WHY EVERYONE. tailoringRun moved from 5 credits to 20 — a
-- flat ×4 on the single action every other cost anchors against (§6.9,
-- and 0089's own header). Someone who bought 20 credits before this
-- migration paid ₦2,500 for four tailorings at the old rate (20 / 5 = 4).
-- After the rebase, one tailoring costs 20 credits, so the SAME 20 credits
-- would only buy one — the four tailorings they already paid for would
-- have shrunk to one without this migration. Multiplying every existing
-- balance by four is what makes "already paid for four tailorings" and
-- "holds four tailorings' worth of credits" the same statement before and
-- after the rebase, for every user, not just future purchasers.
--
-- WHY A LEDGER ROW, NOT A SILENT UPDATE. credit_ledger is the audit trail
-- every other balance change in this system goes through (0035's own
-- atomic spend, every grant) — a balance that changed with no corresponding
-- row would be invisible to it, and indistinguishable from a bug the next
-- time someone reconciles credits_balance against the ledger sum.
--
-- WHY THE CTE, NOT TWO PASSES. `new_balance` is read back from the UPDATE's
-- own RETURNING clause rather than computed by re-reading the table after —
-- one statement, so there is no window between "raise the balance" and
-- "record why" for a concurrent spend to land in. delta is derived as
-- new_balance * 3 / 4 rather than carrying the pre-update value through a
-- second read: since new_balance = old_balance * 4 by construction, that
-- division is always exact integer arithmetic (new_balance is always a
-- multiple of 4 here), and delta = new_balance - old_balance =
-- new_balance - new_balance/4 = new_balance * 3/4.
--
-- WHY `credits_balance > 0` AS THE FILTER. A user sitting at zero has
-- nothing to rebase — multiplying zero by anything is still zero, and a
-- zero-delta ledger row would just be audit-log noise with nothing to
-- explain.
--
-- Passes are NOT touched here. Existing active passes keep their original
-- terms and expiry, including the founder's own — a Pass is a fixed period
-- already paid for at a fixed price, not a balance denominated in the unit
-- that just got repriced, so there is nothing here for a ×4 to apply to.
with rebased as (
  update public.profiles
  set credits_balance = credits_balance * 4
  where credits_balance > 0
  returning id, credits_balance as new_balance
)
insert into public.credit_ledger (user_id, delta, reason, balance_after)
select id, (new_balance * 3) / 4, 'pricing_rebase_4x', new_balance
from rebased;
