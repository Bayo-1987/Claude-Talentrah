-- 0157 — closes a real, live double-charge race in pass auto-renewal,
-- found by a load-testing pass that raced two concurrent
-- runPassRenewalJob() calls against one seeded due Pass and watched
-- chargeAuthorization get invoked twice for it.
--
-- `chargeDueRenewals` (src/lib/billing/renewals.ts) selects its work-list
-- with a plain SELECT and no lock or claim. `/api/admin/renew-passes` has
-- two entry points calling the same job (GET for Vercel Cron, POST for a
-- manual trigger) — the same two-entry-point shape as mentor payouts and
-- session reminders, both of which already protect against exactly this.
-- Pass renewal did not. `chargeOne`'s own retry logic (checking
-- `pending_renewal_reference`, verifying before re-charging) only protects
-- a single run resuming after ITS OWN timeout; it does nothing for two
-- genuinely concurrent runs, because neither has written anything yet when
-- the other reads.
--
-- The fix follows this codebase's own established pattern rather than
-- inventing one: an atomic conditional UPDATE claims a row in the same
-- statement that reads its eligibility, before any Paystack call is made —
-- the same shape as mentorship session reminders' `.is("reminder_sent_at",
-- null)` claim. A staleness window (not a permanent claim) means a run that
-- crashed mid-charge doesn't permanently strand the row: the indeterminate-
-- retry path already expects "the next daily cron run" to pick it back up,
-- by which time any staleness window measured in minutes has long expired.
--
-- No grant change needed: user_passes already has zero authenticated write
-- grant on every column (0151 — "every write is service-role only"), so a
-- new service-role-only column needs nothing further.
alter table public.user_passes
  add column renewal_claimed_at timestamptz;

comment on column public.user_passes.renewal_claimed_at is
  'Set atomically by chargeDueRenewals'' claim step immediately before processing a due row, so two concurrent job invocations cannot both charge the same renewal. Cleared only implicitly by the row leaving the due set (next_renewal_date advances or nulls); a stale claim (see CLAIM_STALENESS_MINUTES in renewals.ts) is reclaimable so a crashed run does not permanently strand the Pass.';
