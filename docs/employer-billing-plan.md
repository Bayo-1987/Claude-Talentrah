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

## 7. Open questions for you

1. **Minimum top-up**, and does an unspent balance ever expire? Expiry has
   consumer-protection implications in some jurisdictions — I would say no
   expiry unless someone has checked.
2. **Refunds** — is an unspent balance withdrawable, or credit-only? Withdrawable
   means payouts and KYC, which §6.7 already avoided for referrals for exactly
   that reason.
3. **Low-balance threshold** — percentage, absolute, or "one day's spend"?
4. **Who in an org can top up?** Today `organization_members` has `owner` and
   `admin`. Spending money is plausibly owner-only.
