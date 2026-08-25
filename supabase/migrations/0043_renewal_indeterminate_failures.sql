-- 0043 — State needed to tell "the customer's card was declined" apart from
-- "Paystack never answered", across renewal-job runs.
--
-- THE BUG. `chargeOne` caught every failure from `chargeAuthorization` in one
-- branch whose comment asserted a single cause — "Paystack rejected the charge
-- outright" — and called `markLapsed`, which sets
-- `auto_renew_status = 'lapsed'` and `next_renewal_date = null`. The job selects
-- on `next_renewal_date <= today`, so nulling it is what makes the lapse
-- permanent: the Pass is never looked at again, and the design deliberately has
-- no dunning to undo it. A timeout or a 502 from Paystack therefore cancelled a
-- subscription the customer was paying for and had done nothing to lose.
--
-- THE POLICY THESE COLUMNS IMPLEMENT. Stated here rather than only in code
-- because it is a product decision, not a mechanical fix:
--
--   * A GENUINE DECLINE still lapses on the first attempt. Unchanged, and
--     deliberately so — that was a reasoned call in the original renewal build
--     ("no retry/dunning, a single failed attempt is enough to lapse it"), and
--     reversing it while fixing something else would be a bigger change than
--     the one being asked for.
--
--   * AN INDETERMINATE FAILURE does not lapse. The Pass keeps
--     `auto_renew_status = 'active'`, keeps its `authorization_code`, and keeps
--     a non-null `next_renewal_date`, so the next daily cron run picks it up
--     again. Retrying is the whole recovery mechanism; there is no dunning
--     queue and no operator alert, so if the next run does not retry, nothing
--     ever will.
--
--   * BOUNDED, NOT INFINITE. `renewal_attempt_count` caps the retries. Without
--     it, a Pass pointed at an endpoint that never answers would promise
--     renewal forever while delivering nothing, which is a different kind of
--     lie to the customer. After the cap it lapses — by then the failure is no
--     longer plausibly transient.
--
-- WHY `pending_renewal_reference` MATTERS MOST. A timeout can happen AFTER
-- Paystack has already debited the card. Charging again on the next run would
-- bill the customer twice for one period — strictly worse than the bug being
-- fixed. So an indeterminate attempt records its reference here, and the next
-- run verifies that reference BEFORE charging: if it actually succeeded, the
-- Pass is extended from it and no second charge is made.
--
-- NOT A 0041-CLASS COLUMN, checked rather than assumed: `user_passes` has RLS
-- enabled and exactly one policy, `SELECT` ("users can read their own passes").
-- With no write policy, a client cannot write any column here regardless of the
-- table-wide grant — the row policy refuses first. These columns are written
-- only by the renewal job under `service_role`.

alter table public.user_passes
  add column if not exists renewal_attempt_count integer not null default 0,
  add column if not exists pending_renewal_reference text,
  add column if not exists last_renewal_failure_at timestamptz;

comment on column public.user_passes.renewal_attempt_count is
  'Consecutive INDETERMINATE renewal failures (Paystack unreachable / 5xx / timeout). Reset to 0 on any resolved outcome — success or a genuine decline. A genuine decline never increments it; it lapses on the first attempt.';

comment on column public.user_passes.pending_renewal_reference is
  'Paystack reference of an attempt whose outcome is unknown. The next run verifies this BEFORE charging again, so a timeout that happened after Paystack debited the card does not become a double charge.';

comment on column public.user_passes.last_renewal_failure_at is
  'When the most recent indeterminate failure happened. Operational only — nothing branches on it; it exists so a human reconciling a stuck Pass can see how long it has been failing.';

-- Finding Passes stuck mid-retry is an operator question, not a hot path, but
-- the partial index is nearly free and keeps that lookup honest.
create index if not exists user_passes_pending_renewal_idx
  on public.user_passes (pending_renewal_reference)
  where pending_renewal_reference is not null;
