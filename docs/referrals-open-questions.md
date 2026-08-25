# Refer & Earn — open questions for the founder

Three things the reward system currently does that are *decisions*, not bugs.
Each is pinned by a test asserting today's behaviour, so nothing changes by
accident — but each is a call about referral economics or trust that belongs to
whoever owns build-prompt open item #4 (exact referral reward trigger/value),
not to whoever next edits the code.

Written 2026-08-25 alongside `tests/referrals/referrals.test.ts`.

---

## 1. A capped-out reward is silent, and permanent

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

**The decision.** Three defensible options, none of them free:

| Option | Cost |
|---|---|
| **Retry when the window clears** — a scheduled sweep re-attempts activation bonuses for referrals capped in the last N days | Needs a job and a "capped" marker; changes payout economics (the cap becomes a rate limit, not a ceiling) |
| **Show it distinctly** — a "monthly limit reached" state on the refer page, no payout change | Cheapest. Honest, but tells the user they hit a limit they were never shown up front |
| **Leave it** | Free today, and the support burden lands whenever someone actually refers 11 people |

Nothing in the code assumes one of these. `tests/referrals/referrals.test.ts`
pins the current behaviour so a change is deliberate.

---

## 2. The signup bonus needs no activation at all

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
