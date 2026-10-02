# Account deletion (ACCT-1)

How a person deletes their account, what is built, and what is still to come. The classification of every place that holds a person is in
[account-deletion-map.md](account-deletion-map.md); the tests read it.

## The flow (PR 1, migration 0212)

1. **Settings → Delete account.** The person types `delete my account`. If something stands in the way, the reasons are shown instead of the form:
   a paid mentoring session still ahead (as mentor or mentee), a mentor payout not yet paid, an organisation they own that other people belong to.
2. **An emailed link**, not a password prompt (people who signed in with Google have no password). 32 random bytes; the database keeps only the sha256.
   Valid for one hour, works once, works only for the person it was issued to (the confirm takes the id from the session). A newer request replaces an
   older one; three an hour at most.
3. **The link opens a page; one click confirms.** Opening it changes nothing (mail scanners open links).
4. **Confirming, in one transaction** (`account_deletion_confirm`): `profiles.deletion_requested_at` is set; the hard delete is scheduled 30 days out
   (a later PR runs it); Auto-Apply is switched off and its queue dismissed; Pass auto-renewal is cancelled (the same four columns the Billing page's own
   cancel writes, and the stored card authorisation is dropped); for the **only member of an organisation**, its open postings are closed and its running
   campaigns paused. The organisation, its postings and the applications it received are kept: they are other people's records. Applicants are not emailed.
   Then the session is ended everywhere.
5. **Hidden at once, in the database:** one flag, read by the Talent Directory (count, preview, search, portfolio, contact), the employer applicant views
   (list, resume, context, counts, assessment files), mentor discovery (RLS policies, open slots, names, booking) and the referral leaderboard.
6. **No email, from any sender.** `getResendClient()` returns a client whose `emails.send` drops recipients whose profile carries the flag, so a sender
   written later is covered too (and `tests/email/every-sender-uses-the-guarded-client.test.ts` keeps that the only door). `recipient-eligibility.ts`
   answers the same question for senders that want to know before they do work.
7. **Signing in again** inside the 30 days lands on "Your account is scheduled for deletion on <date>. Restore it, or keep the deletion?". It never
   restores silently. Restoring puts visibility back; Auto-Apply stays off, renewal stays cancelled, closed postings stay closed.

## What is not built yet

- **PR 2:** "Download my data" (JSON for every user-owned table, plus a README on getting resume PDFs, plus the person's uploaded files), behind the session.
- **PR 3:** the 30-day purge on its own cron entry, in small resumable batches, with the `block` and `decide` rows of the map resolved
  (`organizations.created_by`, `ad_campaigns.created_by`, `employer_applicant_status.updated_by`, `profiles.referred_by`, and what survives of a mentor).
- Unused credits are **recorded** as forfeited (`account_deletions.credits_forfeited`) and stay on the balance until the purge, so a restore gives them
  back. `refund_policy` and `refund_note` are nullable and unused, so a refund policy can be added later with no migration.

## Where things are

| | |
|---|---|
| SQL | `supabase/migrations/0212_account_deletion_request.sql` |
| Server Actions | `src/lib/account-deletion/actions.ts` |
| Pages | `/settings` (the section), `/settings/delete-account/confirm`, `/settings/account-deletion` (the prompt) |
| The gate | `requireUser()` redirects a pending account to the prompt; the pages that ARE the prompt pass `allowPendingDeletion` |
| Tests | `tests/rls/account-deletion-*.test.ts` (database), `tests/lib/account-deletion/`, `tests/lib/email/`, `tests/email/`, `tests/components/account-deletion/` |
