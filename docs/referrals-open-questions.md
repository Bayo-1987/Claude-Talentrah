# Refer & Earn — open questions for the founder

Three things the reward system did that were *decisions*, not bugs. **#1 and #2 were decided on 2026-10-02 (below); #3 is still open.**
Each is pinned by a test asserting today's behaviour, so nothing changes by
accident — but each is a call about referral economics or trust that belongs to
whoever owns build-prompt open item #4 (exact referral reward trigger/value),
not to whoever next edits the code.

Written 2026-08-25 alongside `tests/referrals/referrals.test.ts`.

**Update, 2026-09-04:** the specific credit amounts below (`5`, `20`) are the
values that were live when this was written and are now stale — 0092
re-priced the signup bonus to 10 and the activation bonus to 40 (two CV
tailorings) to correct a repricing gap the 0089 rebase left behind. See
`src/lib/referrals/rewards.ts` for the current amounts and the reasoning.
Left the numbers below unedited as the historical record the decisions here
were actually made against; only the amounts changed, not the shape of any
of the three open questions.

---

## 1. A capped-out reward is silent, and permanent — RESOLVED 2026-10-02: keep the cap, say it plainly everywhere

**Decision (owner, 2026-10-02).** The cap stays: **10 rewarded referrals per referrer in any rolling 30 days** (the unit is referrals, not credits, and the window rolls; it is
not a calendar month). It is now stated, with its real unit, on the public `/refer` page and on the signed-in `/refer` ("Up to 10 rewarded referrals in any 30 days."), and
`/refer` tells a referrer who has reached it what the limit is, that referrals which activate while they are at it still count on the leaderboard (they do: it counts activated
referrals whether or not they were paid), and when it clears. **No referral ever silently goes unpaid without the referrer being able to see why:** since 0215 a referral is paid
the whole reward at activation or not at all, so an activated referral whose paid amount is below the full reward can only have been withheld by the limit, and `/refer` says so on
that row (derived from the stored amount; no new column, no retry sweep, no payout change). Pinned by `tests/referrals/referrals.test.ts` and `tests/referrals/referral-copy.test.ts`.

*The original write-up follows as the historical record the decision was made against.*

**What happens today.** The cap is 10 rewarded referrals per referrer per
rolling 30 days. When it's hit, `grant_referral_reward` simply returns — no
error, no flag, nothing written. But `check_and_activate_referral` marks the
referral `'activated'` *before* calling it.

So a referral can end up **marked activated with its activation bonus never
paid**, and nothing ever retries it once the window rolls forward, because the
status is no longer `'signed_up'` and only that status is eligible.

**A correction to how this was first described to me:** the row does not show a
reward of `0`. Measured, it shows `5` — the signup bonus, paid before the
window filled — and is simply missing the `20` it should have gained on
activation. That's arguably worse than a visible zero, because the referral
looks *partly* paid, so nothing about it suggests anything was withheld.

**Why it matters.** This is a founder-facing growth feature. A user who
genuinely referred eleven people sees ten rewards and one that looks activated
but underpaid, with no explanation anywhere in the product. That reads as the
product being broken or dishonest, which is expensive for exactly the users who
are promoting it hardest.

---

## 2. The signup bonus needs no activation at all — RESOLVED 2026-10-02: reward on activation only (0215)

**Decision (owner, 2026-10-02).** A friend merely signing up pays **nothing**; **activation pays the whole reward**, and the total per activated referral is unchanged (50 credits,
which used to be 10 at signup + 40 at activation), so an honest referrer is no worse off. Referrals that signed up before 0215 had already been paid their 10-credit signup half;
at activation they receive only the remainder (40), so every referral ends at the same total: **no double payment, no clawback**, and credits already earned stay as they are.
"Activated" keeps its existing definition (a base resume saved, or an application sent), now described in plain words on both pages. Self-referral detection (0036) is unchanged.
Migration `0215_referral_reward_on_activation.sql` (also makes the activation claim atomic); the reward notification and email wording were updated to match
(send-462). The 50 is `REFERRAL_REWARD_CREDITS` in `src/lib/referrals/rewards.ts`, and the DB-backed tests read the amount the live trigger really grants and compare it.

*The original write-up follows as the historical record the decision was made against.*

5 credits are granted the moment a referred account exists, with a resolved,
non-self referral code. No email confirmation is enforced at that point, no
activity is required, and there is no signup rate limit.

**The cap is the only thing bounding this.** Measured: 15 rapid throwaway
signups against one code yield exactly 10 bonuses and 50 credits — the cap
holds, which is the good news. The open question is whether **50 credits per 30
days for zero activity** is the intended cost of the programme. At the
researched anchor (~₦150/credit) that's ~₦7,500 a month per code, for the price
of ten disposable addresses.

Options if that's too generous: gate the signup half on email confirmation, move
more of the reward to the activation half, or lower the cap. All are pricing
calls, not code fixes.

---

## 3. Referral codes are case-sensitive

`generate_referral_code` always emits uppercase; the signup lookup does no case
folding. A lowercased copy of a link — plausible the moment any share surface,
email client or URL shortener lowercases it — **silently attributes nothing**.
No error, no fallback, and the referrer never finds out.

Not fixed here because it's a link-handling product call: normalise the lookup
to be case-insensitive (simple, slightly widens the code space collision-wise),
or leave codes strictly uppercase and make sure every share surface preserves
case. Pinned by a test either way.

---

## Not open — settled and tested

- **Self-referral via a Gmail dotted alias** was a live farming vector and is
  fixed (migration `0036`). Dot-stripping is scoped to `gmail.com` /
  `googlemail.com` deliberately: at a corporate domain `j.doe@` and `jdoe@` are
  routinely two different people, and blocking that would deny two colleagues a
  legitimate reward.
- **A fabricated manual Job Tracker entry pays the activation bonus.** That is
  the documented rule ("completed profile OR first application") working as
  written, not a defect. Bounded by the cap. Pinned by test.
- **Deleting and re-inserting a base resume does not pay twice** — the
  `status = 'signed_up'` guard is the only thing preventing it, and it holds.
  Worth knowing, because that guard becomes load-bearing the day a resume-delete
  UI ships.
