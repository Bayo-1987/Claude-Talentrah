# Account deletion (ACCT-1)

How a person deletes their account, what is built, and what is still to come. The classification of every place that holds a person is in
[account-deletion-map.md](account-deletion-map.md); the tests read it.

## The flow (PR 1, migration 0212)

1. **Settings → Delete account.** The person types `delete my account`. If something stands in the way, the reasons are shown instead of the form:
   a paid mentoring session still ahead (as mentor or mentee), a mentor payout not yet paid, an organisation they own that other people belong to.
2. **An emailed link**, not a password prompt (people who signed in with Google have no password). 32 random bytes; the database keeps only the sha256.
   Valid for one hour, works once, works only for the person it was issued to (the confirm takes the id from the session). A newer request replaces an
   older one; three an hour at most.
3. **The link opens a page; one click confirms.** Opening it changes nothing (mail scanners open links). The link is stored only as a sha256 (`token_hash`, unique), looked up by
   that hash AND the session's own user id under a row lock, so there is no comparison of the secret to time; a request made after it supersedes it ("a newer
   confirmation email has been sent"), a used one says "already been used", an expired one says it expired. Each is its own message and none touches the card.
4. **Confirming, in this order** (`confirmAccountDeletionAction`):
   1. `account_deletion_confirm_precheck`: every refusal, with nothing changed, and the list of stored card authorisations (Pass renewals, and Talent Directory renewals of
      organisations this person created).
   2. **The card comes first.** Renewals are not provider-side subscriptions; our own daily cron charges a stored Paystack authorisation code. So each code is cancelled with
      `POST /customer/authorization/deactivate` (the path Paystack's current documentation gives; once per distinct card). **If the provider cannot be reached or refuses, the deletion
      is not scheduled at all**: the person is told "nothing has been scheduled" and stays signed in. The only refusal that counts as cancelled is Paystack's **documented** not-found:
      HTTP 404 with a real error envelope (a documented `type` and a `code`). It is matched on those fields and **never on the message text**; a bare 404, a 401, a 429, an
      unreadable body or a network failure all block (`provider-cancel.test.ts` gives the same words to cases that must differ). Paystack publishes no code value for "already
      deactivated", so the rule is the documented status plus the documented envelope. The stored code is also cleared in our database and only our own secret key can charge it, so
      this is defence in depth, which is why only a documented answer may pass.
      **The endpoint has not been exercised live** (no test key was available); the classification rests on the documented envelope. Every deactivate call therefore logs one structured
      line, `[account-deletion] PAYSTACK_DEACTIVATE {"http_status":…,"status":…,"type":…,"code":…,"classification":"deactivated|already-deactivated|blocked"}` (exactly those five fields; never
      the authorisation code, the key, the email or the message text; a blocked call logs at ERROR), and an `already-deactivated` also logs at WARN under the tag
      `PAYSTACK_ALREADY_DEACTIVATED`: on a person's first deletion it is suspicious, since a wrong path also answers 404. The stored code is cleared in our database in every outcome that
      schedules the deletion (`account_deletion_confirm`) and in the cancelled-but-not-scheduled outcome (`account_deletion_stop_renewals`), so a misclassification cannot let a renewal charge.
      **If the provider succeeded and the database transaction then fails** (or refuses, apart from "already used"), the card is cancelled but nothing is scheduled, so our renewal cron
      would fail to charge and lapse the Pass unexplained. `account_deletion_stop_renewals` switches renewal off in its own small write and the person is told plainly that renewal is off,
      the deletion was not scheduled, and to try again (or, if that write fails too, that the Pass may fail to renew and to contact us).
   3. `account_deletion_confirm`, one transaction: `profiles.deletion_requested_at` is set; the hard delete is scheduled 30 days out (a later PR runs it); Auto-Apply is
      switched off and its queue dismissed; Pass and Talent Directory auto-renewal are cancelled in the database (the stored authorisation is dropped); for the **only member of an
      organisation**, its open postings are closed and its running campaigns paused. The organisation, its postings, **its ad wallet** and the applications it received are kept:
      they are other people's records, or the organisation's. Applicants are not emailed.
   4. The session is ended everywhere (`signOut({ scope: "global" })`). Its failure does not undo the deletion: the gate below catches every later request.
   5. The "scheduled" email is sent. Its failure does not undo the deletion either.
5. **Said plainly, with the real titles, on the screen and in both emails:** "These postings will be closed now and permanently removed 30 days after closing. Restoring your
   account won’t reopen them." (The existing sweep removes a closed posting 30 days after closing; this is not new behaviour, only now stated.) For an organisation with an ad
   wallet balance: the balance, that it stays with the organisation and is not forfeited, and that nobody can use it unless the person restores or someone joins. Refunds of unused
   credits or the wallet are **not** offered: that is on the owner's list for the lawyer, and `refund_policy`/`refund_note` exist unused for when it is decided.
6. **Hidden at once, in the database:** one flag, read by the Talent Directory (count, preview, search, portfolio, contact), the employer applicant views
   (list, resume, context, counts, assessment submissions and files), mentor discovery (the `mentor_profiles`, `mentor_availability_slots` and `mentorship_reviews` SELECT policies,
   open slots, names, counterparty names, booking) and the referral leaderboard. Another signed-in user querying those tables directly gets nothing
   (`tests/rls/account-deletion-hide.test.ts`). Each affected function is **patched from its live definition**, not recreated from a copy, so a change that landed since cannot be
   reverted, and its definer flag, `search_path` and grants are untouched (`tests/rls/account-deletion-function-grants.test.ts` holds that to an explicit table).
7. **The session itself is gated on every request, at no database cost** (`src/lib/auth/pending-deletion-gate.ts`, in `src/proxy.ts`): the gate reads `app_metadata.deletion_pending`
   off the user the proxy's own `auth.getUser()` already returned (a live call, so it is current). Confirm sets it and restore clears it, with the service role, beside
   `profiles.deletion_requested_at`, which stays the source of truth. A flagged session lands on the prompt on its very next request (API calls get a 403 JSON), even if the global sign-out failed.
   **The refreshed session cookies survive the redirect**: every `Set-Cookie` of the response the middleware refreshed is copied onto the redirect verbatim (a redirect that dropped them is how
   a person gets signed out at random). Exempt, so there is never a loop: the prompt, the confirm link's page, sign-in, the auth routes, the admin surfaces, and static assets.
   `requireUser()` is a second gate and the database a third; none relies on another. **Every fail-open is logged and counted**: `[pending-deletion] FAIL_OPEN kind=… count=…`
   (`flag_not_set`, `flag_not_cleared`, and `gate_missed` when `requireUser` finds the database pending while the session carried no flag). A stale flag after a failed clear is healed by the prompt page.
8. **No email, from any sender, except the deletion's own three.** `getResendClient()` returns a client whose `emails.send` drops recipients whose profile carries the flag, so a
   sender written later is covered too (and `tests/email/every-sender-uses-the-guarded-client.test.ts` keeps that the only door). Each drop is logged `reason=deleted_pending` and
   reported as sent, so nothing retries. The three exceptions (`deletion_confirm`, `deletion_scheduled`, `deletion_restored`) go through `sendDeletionLifecycleEmail()`, listed in
   [account-deletion-map.md](account-deletion-map.md#deletion-lifecycle-emails); a test fails if the list and that table disagree. The closing-date reminder skips a pending owner and
   falls back to the organisation's creator, and does nothing (and fails nothing) when both are pending.
9. **Signing in again** inside the 30 days lands on "Your account is scheduled for deletion on <date>. Restore it, or keep the deletion?". It never restores silently. Restoring puts
   visibility back and emails the proof; Auto-Apply stays off, a Pass does not renew until the person resubscribes, closed postings stay closed.

## What is not built yet

- **PR 2:** "Download my data" (JSON for every user-owned table, plus a README on getting resume PDFs, plus the person's uploaded files), behind the session.
- **PR 3:** the 30-day purge on its own cron entry, in small resumable batches, with the `block` and `decide` rows of the map resolved
  (`organizations.created_by`, `ad_campaigns.created_by`, `employer_applicant_status.updated_by`, `profiles.referred_by`, and what survives of a mentor).
- Unused credits are **recorded** as forfeited (`account_deletions.credits_forfeited`) and stay on the balance until the purge, so a restore gives them
  back. `refund_policy` and `refund_note` are nullable and unused, so a refund policy can be added later with no migration.

## Where things are

| | |
|---|---|
| SQL | `supabase/migrations/0212_account_deletion_request.sql`; its exact undo is `supabase/rollbacks/0212_account_deletion_request.rollback.sql` |
| Server Actions | `src/lib/account-deletion/actions.ts` |
| Pages | `/settings` (the section), `/settings/delete-account/confirm`, `/settings/account-deletion` (the prompt) |
| The gates | `src/lib/auth/pending-deletion-gate.ts` (every request), `requireUser()` (pages; the pages that ARE the prompt pass `allowPendingDeletion`), the database (everyone else's reads) |
| Tests | `tests/rls/account-deletion-*.test.ts` (database), `tests/lib/account-deletion/`, `tests/lib/email/`, `tests/email/`, `tests/components/account-deletion/` |
