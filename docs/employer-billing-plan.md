# Employer billing — design brief

**Status: proposal. No code, no migrations.** Written before implementation
deliberately: this is the first genuinely new financial model in the codebase,
and the two fixes in this repo that went best (the org-domain constraint and the
dedup key) were both designed against evidence before code existed to defend.

Scope here is **billing only** — the thing that has to exist before an ad
campaign can be charged for. Ad Campaign Manager itself is the next piece.

---

## 1. The recommendation, in one line

**A prepaid wallet per organisation, topped up through the existing Paystack
rail, drawn down by flat-rate campaigns. No metering, no invoicing, no credit
in v1.**

---

## 2. What is reusable, and what only looks reusable

Worked out by reading the code rather than by category, because the parts that
*look* closest are the ones that fit worst.

### Genuinely reusable

| Piece | Why it transfers |
|---|---|
| `paystackFetch` + the 15s `AbortSignal.timeout` | Rail-level, product-agnostic. |
| `PaystackDeclineError` / `PaystackUnavailableError` / `isDecline` | **More** important here than for Passes. A top-up that times out has the identical "did the card get charged?" ambiguity 0043 was written for, and the `isDecline` inversion — only affirmative evidence of refusal counts against the customer — applies unchanged. |
| `payment_transactions` as the ledger shape | `rail`, `product_type`, `product_id`, `paystack_reference`, `status`. Adding a product type is additive; the row shape already anticipates multiple rails. |
| `verifyTransaction`-before-recharge, and `pending` for unknown outcomes | Same double-charge risk, same answer. |
| The **pattern** of `spend_credits_atomic` | Not the function — see §3. |

### Looks reusable, is not

**`runPassRenewalJob` and the whole renewal model.** A Pass renewal is a
*fixed-price, fixed-date recharge*: one amount, one calendar date, selected by
`next_renewal_date <= today`, charged in full, date pushed forward. Ad spend is
*consumption against a budget*. The renewal job's entire shape — find what's
due, charge the price, advance the date — has no counterpart.

Forcing campaigns through it would produce code that reads like reuse and
behaves like neither thing. Concretely, `user_passes` has
`next_renewal_date`, `auto_renew_status`, `renewal_attempt_count` and
`pending_renewal_reference`; a campaign has a budget, a spend-to-date and a
run state. The overlap is one column (`authorization_code`, if we ever store
one) and that is not a model.

**`credit_ledger` / Talentrah Credits.** Credits are a *seeker-side* concept
priced per AI action (§6.9). Employers buying ad inventory is a different
product with different pricing, different tax treatment, and a different buyer.
Sharing the ledger would couple two pricing experiments that need to move
independently — and §10 says both are unvalidated anchors that need a real
pricing test.

---

## 3. Atomicity — designed in, not hardened later

The wallet decrement is `spend_credits_atomic`'s bug waiting to happen, and it
is the same bug 0035 fixed after it had been live for months:

```
read  wallet.balance_kobo            -- 5000
check balance >= cost                -- 5000 >= 5000, ok
write balance = 5000 - 5000          -- computed in JS
```

Two concurrent draw-downs both read 5000, both pass, both write 0. One campaign
charge is delivered and paid for by nobody, and the ledger stops reconciling
with the cached balance — which is exactly what made 0035 hard to reason about
after the fact.

**So the decrement is a single conditional `UPDATE` from the first commit**,
modelled directly on `spend_credits_atomic` (0035):

```sql
create function public.debit_ad_wallet(
  p_organization_id uuid,
  p_amount_kobo bigint,
  p_reason public.ad_billing_reason,
  p_related_entity_id uuid default null
) returns table (ok boolean, balance_after_kobo bigint)
...
  update public.ad_wallets w
     set balance_kobo = w.balance_kobo - p_amount_kobo,   -- RELATIVE, never
         updated_at   = now()                             -- a value from JS
   where w.organization_id = p_organization_id
     and w.balance_kobo >= p_amount_kobo
  returning w.balance_kobo into v_new_balance;
```

Non-negotiable properties, each of which 0035 had to learn:

* the decrement is **relative** (`balance - amount`), never a number computed
  outside the database;
* the check and the write are **one statement**, so a concurrent debit blocks on
  the row lock and re-evaluates against the value the winner already wrote;
* the ledger row is written from the balance the `UPDATE` actually returned, so
  ledger and cached balance cannot diverge under contention;
* `service_role` only — `p_organization_id` is an argument, and granting this to
  `authenticated` would turn that argument into a forgeable authorisation, the
  same reasoning as 0034 and 0035.
* **Amounts in kobo as `bigint`**, never a float. Naira has no sub-kobo unit and
  binary floats cannot represent 0.1; `payment_transactions.amount` should be
  read for its existing convention and matched.

And a standing test in the shape of `tests/credits/spend-race.test.ts`: N
concurrent debits against a balance affording M must succeed exactly M times.
That test is what made the credits fix trustworthy and it is cheap to copy.

**Column privileges.** `ad_wallets.balance_kobo` is the highest-value column
this codebase would have. Per the 0028/0030/0031/0041 class — which this repo
has now hit four times — the table gets `revoke update … from authenticated`
with **no** column grant back. Employers read their balance; nothing client-side
writes it.

---

## 4. What happens at zero — the policy call

**Campaigns pause. They do not run negative and get invoiced.**

Stated explicitly rather than chosen implicitly, the way 0043's decisions were:

* **Pausing matches what the codebase already does under uncertainty.** Auto-Apply
  is review-before-submit and server-capped. The renewal job refuses to lapse on
  evidence it cannot attribute. The consistent posture is *stop and surface*,
  not *proceed and reconcile*.
* **Post-pay means collections, and collections means a product we do not have.**
  Running negative creates a debt, and a debt needs dunning, credit assessment,
  and a way to pursue non-payment across jurisdictions. §10 already flags
  multi-jurisdiction tax/KYC as unreviewed. Choosing post-pay would quietly
  commit to building all of that.
* **A paused campaign is honest; an over-delivered one is not.** If the wallet
  cannot cover the next charge, we have not been paid for the impression we
  would serve. Serving it anyway and asking later is the shape of the
  premium-template defect 0042 fixed — delivering something the payment state
  does not support.
* **The asymmetry favours pausing.** A paused campaign costs the employer some
  reach until they top up, and they can see and fix it. An unpaid campaign costs
  Talentrah real inventory and creates a receivable that may never be collected.

Design consequences:

1. **The check is atomic with the spend.** "Can we afford this?" followed by
   "spend it" is the 0035 bug again. `debit_ad_wallet` returning `ok = false`
   *is* the affordability answer.
2. **Pause is a state transition, not an absence.** `campaigns.status` moves to
   `paused_insufficient_funds` — distinguishable from an employer pausing
   deliberately, because those two need different messaging and different
   resume behaviour.
3. **A low-balance warning before zero**, so pausing is not the first the
   employer hears of it. Threshold TBD; the notification lands in the §6.10
   transactional bucket, neutral system voice not Farah's.
4. **Resume is explicit.** Topping up does not silently restart a campaign that
   was paused for days — the employer decides whether it is still the campaign
   they wanted. Same reasoning as not auto-resubmitting an Auto-Apply queue item.

---

## 5. Multi-rail — a property of the transaction, not a hardcode

§6.9 requires mobile-money-native rails **from day one, not retrofitted**, and
§10 flags diaspora currency/billing as needing legal review before it ships.
Reusing the Paystack rail for top-ups does **not** discharge that.

So the model treats the rail as data even though v1 wires one:

* **`payment_transactions.rail` already exists** and is already populated
  (`'paystack'`). The wallet's top-up rows reuse that column rather than
  inventing a parallel notion.
* **`ad_wallets` carries a `currency`**, not an implied NGN. Balance in minor
  units + an explicit currency code. A wallet is single-currency; a diaspora
  employer gets a USD wallet rather than an NGN wallet with a conversion
  smuggled in — because conversion at spend time is a pricing decision nobody
  has made.
* **No rail-specific logic above the rail boundary.** `debit_ad_wallet` never
  learns how the money arrived. Only the top-up path is rail-aware, and it
  dispatches the same way `fetchSource` dispatches on `config.source` — a
  discriminated union, so adding Flutterwave or a mobile-money provider is a new
  branch and a compile error at every site that must handle it, not a silent
  fallthrough.
* **What v1 actually ships:** Paystack NGN only, including its bank/USSD/transfer
  channels, which is what `NGN_CHANNELS` already documents as this market's
  low-friction rails. That satisfies "mobile-money-native" in the sense §6.9
  means for Nigeria. It does **not** satisfy diaspora, and the doc should not
  pretend otherwise — that stays blocked on §10's legal review.

**Explicitly out of scope until legal review:** multi-currency conversion,
diaspora billing, Stripe, and anything that stores a card token for employers.

---

## 6. Proposed shape

Sketch, not final. No migration until this is agreed.

* **`ad_wallets`** — one per organisation. `organization_id`, `currency`,
  `balance_kobo bigint`, timestamps. No client write grant.
* **`ad_wallet_ledger`** — append-only. Every credit and debit, with
  `reason`, `related_entity_id`, `balance_after_kobo`. Modelled on
  `credit_ledger`, including that the ledger is the record of truth and the
  wallet balance is a cache the ledger must always reconcile with.
* **`payment_transactions`** — gains an ad-wallet-topup product type. No new
  payments table.
* **`debit_ad_wallet(...)`** — §3.
* **`credit_ad_wallet(...)`** — the top-up side, called only after Paystack
  confirms, and **idempotent on `paystack_reference`** so a webhook redelivery
  cannot double-credit. (Paystack retries webhooks; this is not hypothetical.)

## 7. Decisions

Answered by the founder 2026-08-26. Recorded with reasoning rather than relayed,
because a decision without its reasoning is one someone reverses next year
without knowing what it cost.

### 7.1 Refunds — credit-only, never cash-refundable

An unspent balance buys ad inventory and nothing else. It cannot be withdrawn.

**Why.** A withdrawable balance is a money-transmission surface: it needs a
payout rail, KYC on the recipient, and a position on what happens when the
payout destination differs from the funding source. §6.7 already made exactly
this trade for referrals — *"Prefer credit rewards over cash (avoids KYC/payout
infra)"* — and the same reasoning applies with more force here, because employer
top-ups will be larger than a referral reward.

**What this constrains.** No refund path, so **the low-balance warning and the
pause-at-zero behaviour in §4 are load-bearing rather than nice-to-have**: if an
employer over-funds, their only remedy is to spend it. That makes over-funding a
product problem, which is an argument for keeping minimum top-ups modest and for
not nudging large prepayments.

**What it does not license.** Credit-only is not permission to keep money for
nothing. If Talentrah cannot deliver the inventory a balance was bought for —
the platform shuts a campaign type down, say — that is a refund question this
decision does not answer, and it should be escalated rather than silently
resolved by pointing at this line.

### 7.2 Expiry — none

Balances do not expire. No expiry column, no sweeper job.

**Why.** Expiry on prepaid value is a consumer-protection question in several
jurisdictions and a trust question in all of them, and §10 already flags
multi-jurisdiction compliance as unreviewed. Adding an expiry we have not had
reviewed would be inventing an answer to an open legal question — the same
mistake `verification.ts` explicitly refuses to make about domain ownership.

Not adding the field is also the cheaper direction to reverse: adding expiry
later is a migration, whereas removing an expiry that has already voided
someone's balance is not fixable.

### 7.3 Low-balance warning — percentage of last top-up; 20% is a PLACEHOLDER

**The mechanism is decided. The number is not.**

Percentage-of-last-top-up was chosen by the founder. The specific figure — 20% —
was **example text in the multiple-choice question used to ask him**, not a
figure anyone has independently deliberated on. It is implemented because the
code needs *a* number, and it is recorded here as provisional so nobody later
reads it as considered.

Tracing it properly, because the attribution drifted twice: §4 originally said
"threshold TBD" and §7 asked percentage-vs-absolute-vs-one-day's-spend without
proposing a number; the 20% then appeared in the option text, was briefly
attributed back to this document, and then to the founder. Neither was right.
**Nobody has deliberated on 20%.**

**Why percentage-of-last-top-up is the right mechanism**, independent of the
number: it scales with how the employer actually uses the product. An absolute
threshold (₦5,000, say) is either noise to a large advertiser or useless to a
small one. "One day's spend" needs a spend rate, which flat-rate campaigns do not
produce — that is a metering concept, and §2 is explicit that v1 has no metering.
Last top-up is the only signal available in v1 that is proportional to the
employer's own scale.

**The number is provisional and MUST be re-checked** once flat-rate campaign
pricing is set — it is a placeholder, not a considered default. If a campaign costs a meaningful fraction of a typical top-up,
20% remaining may be less than one campaign — a warning that arrives after the
employer can no longer afford anything is not a warning. Re-sanity-check when
pricing lands; the mechanism does not change.

**Fires on the debit that crosses the line**, not on a schedule — no polling job,
and no repeat on every subsequent debit below the line.

### 7.4 Who can spend — owner and admin

Both existing `organization_members` roles. No new permission tier.

**Why.** Inventing a third role to gate spend would mean every employer has to
understand and administer a distinction the product does not otherwise make,
which is a real cost paid by every org to constrain a case none has reported.
The two-tier model already exists, is already understood, and already gates the
employer surface.

**Accepted trade, stated plainly:** an `admin` can spend the organisation's
money. That is a deliberate widening versus owner-only, and if it turns out to
be wrong the fix is a narrowing, which is easy — the RPC takes the actor and can
add a role check without a schema change.


---


## 8. What was actually built (2026-08-26)

The plan above was written before any migration. This section records what
shipped against it, including where the build differed from the plan and why.

| Layer | Where | PR |
|---|---|---|
| Wallet, atomic debit/credit | `0046_ad_wallets.sql` | [#48](https://github.com/Bayo-1987/Claude-Talentrah/pull/48) |
| Campaign state machine, review + charge functions | `0047_ad_campaigns.sql`, `0048_ad_campaign_submit_for_review.sql` | [#49](https://github.com/Bayo-1987/Claude-Talentrah/pull/49) |
| Server Actions, employer UI, review gate | `src/lib/employer/campaign-actions.ts`, `src/app/employer/campaigns/**`, `src/app/api/admin/moderate-campaign/route.ts` | [#50](https://github.com/Bayo-1987/Claude-Talentrah/pull/50) |

### 8.1 Billing unit — per day, not per click

§6.8 of the build prompt says flat-rate first and CPC later. That ordering is
usually read as a commercial choice; it is also the only honest one available
right now. **CPC requires deduplicated, attributable click events, and this
project has no such pipeline** — §8 of the build prompt lists that dedup work
as a prerequisite for ad billing, and it has not been done. Charging per click
today would mean charging for a number the system is guessing at.

Charging per day charges for something observable: that the campaign was
eligible to serve on a given date. `last_charged_on` plus a unique constraint
makes it idempotent, so a cron that fires twice does not bill twice — verified
by `ad-campaigns.test.ts`, "is idempotent — a duplicate cron run does not
charge twice".

### 8.2 Approval never starts a campaign

`set_ad_campaign_review(approve => true)` lands the campaign in
`paused_by_employer`, not `active`. The employer then calls
`resume_ad_campaign`, which debits.

This is one extra click and it buys two things. Approval is a judgement about
the ad's *content*; going live is a decision about *money*, and they belong to
different people — merging them would mean a reviewer's click debits an
employer's wallet. It also leaves exactly **one** code path from not-running to
running, and that path always charges. Two paths would be two places to forget
the charge, which is the shape of most billing bugs.

### 8.3 Where the owner/admin check lives

§7.4 decided owner and admin may both spend. That check is
`requireSpendAuthority` in `campaign-actions.ts` — the **Server Action layer**,
not the database.

That placement is deliberate rather than convenient. The money functions are
`SECURITY DEFINER` and take `p_actor_user_id` as an *argument they cannot
verify*; a role check inside one would be checking a claim made by the caller.
The Server Action is the only layer holding a real session, so it is the only
layer where the check means anything.

It restricts nobody today — `org_member_role` is exactly `owner, admin`, and
both may spend — and its comment says so plainly rather than letting it read as
a live control. It exists as the seam where a third role would land: a future
`viewer` must not inherit spend authority by default.

### 8.4 What the review route does not record

`/api/admin/moderate-campaign` authenticates with a shared admin secret. That
proves *an* operator acted, not *which* operator, so `reviewed_by` is written
as null and the route **refuses to accept a reviewer id from the caller**. A
self-asserted id would make the column look like attribution while being
unverifiable — an honest null is visibly missing, a wrong name is not. Real
per-reviewer attribution needs admin sessions, which is a larger change than
this route.

A rejection without a note is refused outright: the employer has no way to act
on it, and the next reviewer has no way to know what was wrong.

### 8.5 Still open

- **§7.3's 20% low-balance threshold remains a PLACEHOLDER.** Nobody has
  deliberated on it. It is not implemented, so nothing depends on it yet.
- **No top-up UI.** `credit_ad_wallet` exists and is idempotent on
  `paystack_reference`, but the employer-facing Paystack flow that calls it is
  not built — wallets can currently only be funded server-side.
- ~~**The daily charge cron is not wired.**~~ **Fixed** — see §9. It is
  scheduled at 08:00 UTC, after the 05:00 job ingest, so a campaign whose job
  was closed that morning is not billed for a day promoting a dead role.

---

## 9. The daily charge job — failure policy

Added 2026-08-26, when the job that runs §4 was finally written. `0047` shipped
`charge_ad_campaign_day` with three passing tests and **no caller**:

```
$ grep -rn charge_ad_campaign_day src/
src/lib/supabase/types.ts:1476:      charge_ad_campaign_day: {
```

— the generated type, nothing else, and `vercel.json` scheduled three crons,
none of them this. The effect was a money leak rather than a stalled feature:
`resume_ad_campaign` charges the day it activates a campaign, so a campaign was
paid for exactly one day and then advertised until its `ends_on` for free.
`spent_ngn` never grew, so the budget cap never completed it either. An
employer paid one day's rate for a thirty-day run.

Recorded here because the *shape* generalises: a tested function with no caller
is indistinguishable from a missing one, and scores better in a coverage
report. The standing check is now in `tests/api/contract.test.ts` — it asserts
the schedule exists, not just that scheduled paths resolve.

### 9.1 A charge that fails mid-batch does not stop the batch

**Read off the SQL rather than assumed**, because the answer decides whether
the loop may continue. Most of what looks like failure is not an exception at
all:

| Outcome | Returns | Batch treats it as |
|---|---|---|
| Wallet cannot cover the day | `ok=false`, `paused_insufficient_funds` | **normal** — §4 working |
| Budget cap reached / past `ends_on` | `ok=true`, `completed` | normal |
| Already charged for this date | `ok=true`, no-op | normal (idempotent) |
| No longer `active` | `ok=false`, current status | normal (a race) |
| Campaign row is gone | **raises** | error, logged, loop continues |
| Transport / lock failure | **raises or returns `error`** | error, logged, loop continues |

**The loop continues past the errors too.** Each `.rpc()` is its own PostgREST
request and therefore its own transaction, so an error on campaign *N* cannot
roll back campaigns *1..N-1* — they are charged and committed. Aborting there
would leave the tail of the batch `active` and unbilled, which is a narrower
re-creation of the exact defect above. Continuing is the only choice that does
not manufacture the bug again.

**Continuing is not the same as reporting success.** Any raise, or any failed
work-list page, sets `ok = false` and the route answers 500 so a scheduler
alerts — the `runPassRenewalJob` convention. Campaigns that *paused* do **not**
make the run a failure: a healthy run can be full of them, and a 500 for that
would page someone nightly for the system working as designed.

### 9.2 Consequences worth knowing before changing this

* **A duplicated cron delivery is safe; a MISSED one is lost revenue, not
  deferred revenue.** `charge_ad_campaign_day` is idempotent on
  `last_charged_on`, so a double delivery bills once. But the next run charges
  for the *next* day only — the skipped day is never billed. That is the right
  direction to fail in (an employer is never charged for a day we failed to
  bill on time) and it does mean a cron that silently stops firing loses money
  quietly. Recovering a specific day is `POST /api/admin/charge-campaigns?on=`.
* **The work-list is read fully before anything is charged.** The filter is
  `last_charged_on < today` and charging sets `last_charged_on = today`, so a
  charged row leaves the result set. Paging with OFFSET while mutating that
  same predicate silently skips one row per page.
* **The job can be scoped to one organisation.** `?organization_id=` is the
  support-recovery tool — re-run one employer without re-charging everyone
  else. It is also what makes the job testable at all: there is no staging
  database, so an unscoped run from a test would debit every real employer's
  wallet, and no cleanup can undo a charge to a row the suite did not create.
* **Charges are sequential, deliberately.** Campaigns in one organisation all
  debit the same `ad_wallets` row, and `debit_ad_wallet`'s conditional UPDATE
  takes a row lock. Concurrency here buys contention, not throughput. If this
  becomes the slow part, batch inside Postgres rather than opening more
  connections.
