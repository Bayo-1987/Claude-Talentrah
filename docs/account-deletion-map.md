# Account deletion map (ACCT-1)

What happens to every place the database or storage holds a person, when they delete their account. This file is the **classification**; the
tests read it, so a new foreign key into a person, or a new storage bucket, fails CI until somebody decides here what deleting that person means for it.

- `tests/rls/account-deletion-fk-map.test.ts` reads the live foreign keys (the `account_deletion_fk_catalog()` function, 0209) and fails on any key that is
  not in the first table, any entry here that no longer exists, and any entry whose recorded `ON DELETE` or class disagrees with the database.
- The same test lists the storage buckets and fails on any bucket not in the second table.
- `tests/docs/account-deletion-map-format.test.ts` checks this file's shape without a database.

## Classes

| class | meaning |
|---|---|
| `delete` | removed with the person (a CASCADE), at the hard delete 30 days after confirming |
| `anonymise` | the row is kept for tax, audit, or because it is somebody else's record too; the link to the person is set to null (SET NULL) |
| `detach` | a SET NULL on an actor or reviewer column of somebody else's record; the record stays |
| `block` | the foreign key refuses the delete as it stands (NO ACTION or RESTRICT); a later PR resolves it first. The migration or step that does so is named in the note |
| `auth` | the auth schema; removed with the auth user |
| `internal` | test infrastructure, absent from a real account |
| `decide` | a design decision that belongs to the purge PR (PR 3) and is not made here. PR 3's own test fails while any `decide` remains |

Employers: an organisation is not the person's. When the only member of an organisation deletes their account, its open postings are closed (listed by
title in the confirm step) and its running campaigns paused; the organisation, its postings, and the applications on them are kept, because they are
the applicants' records as well. Only the person's own link (`organization_members`, `organizations.created_by`, `ad_campaigns.created_by`) is detached.
Applicants are not emailed: they see the ordinary closed state. An organisation other people belong to blocks the owner's deletion until ownership is
handed over.

## Foreign keys into a person

`child_table.child_column` into `profiles` (or `auth.users`), as read from the production catalogue on 2026-10-02.

| key | parent | on delete | class | note |
|---|---|---|---|---|
| `ad_campaigns.created_by` | profiles | RESTRICT | block | PR 3 makes it nullable SET NULL: the organisation and its campaigns are kept, only the person's link is detached |
| `ad_campaigns.reviewed_by` | profiles | SET NULL | detach | an admin's review of someone else's campaign |
| `ad_events.user_id` | profiles | CASCADE | delete | the person's own impressions and clicks |
| `ad_wallet_ledger.actor_user_id` | profiles | SET NULL | detach | who made an organisation's wallet movement; the movement stays |
| `admin_users.id` | auth.users | CASCADE | delete | admin identity (0060); deleted with the account |
| `api_rate_limits.user_id` | profiles | CASCADE | delete | per-person throttle counters |
| `application_stage_events.user_id` | profiles | CASCADE | delete | the person's own tracker history |
| `applications.user_id` | profiles | CASCADE | delete | the person's own applications and tracker; the applications an organisation received on its postings are other people's records and are kept (see Employers above) |
| `auth.*` | auth.users | CASCADE | auth | every table in the auth schema that points at auth.users (sessions, identities, factors, tokens): removed with the auth user |
| `auto_apply_queue.user_id` | profiles | CASCADE | delete | dismissed at confirm, deleted at purge |
| `auto_apply_settings.user_id` | profiles | CASCADE | delete | switched off at confirm, deleted at purge |
| `country_default_events.user_id` | profiles | CASCADE | delete | product analytics about the person |
| `course_recommendation_clicks.user_id` | profiles | SET NULL | anonymise | an aggregate click log; the row is kept without the person |
| `credit_gate_events.user_id` | profiles | CASCADE | delete | product analytics about the person |
| `credit_ledger.user_id` | profiles | SET NULL | anonymise | tax and audit record (0209): kept, detached from the person |
| `email_preferences.user_id` | profiles | CASCADE | delete | the person's own mail settings |
| `employer_applicant_status.updated_by` | profiles | NO ACTION | block | PR 3 nulls it first: an employer member's review mark on someone else's applicant |
| `farah_messages.user_id` | profiles | CASCADE | delete | Farah threads |
| `farah_session_events.user_id` | profiles | CASCADE | delete | Farah session analytics |
| `feature_flags.updated_by` | profiles | SET NULL | detach | who last changed a flag |
| `feedback.triaged_by` | profiles | SET NULL | detach | an admin's triage of someone else's feedback |
| `feedback.user_id` | profiles | CASCADE | delete | the person's own feedback |
| `job_posting_assessments.created_by` | profiles | SET NULL | detach | who wrote an organisation's assessment; the assessment stays |
| `job_posting_reports.reporter_id` | profiles | CASCADE | delete | reports the person filed |
| `job_postings.admin_reviewed_by` | profiles | SET NULL | detach | an admin's review of someone else's posting |
| `job_postings.removed_by` | profiles | SET NULL | detach | an admin's removal of someone else's posting |
| `job_tailoring_requests.user_id` | profiles | CASCADE | delete | tailoring requests, resumes and cover letters generated for the person |
| `match_scores.user_id` | profiles | CASCADE | delete | the person's own scores |
| `mentor_profiles.reviewed_by` | profiles | SET NULL | detach | an admin's vetting of someone else's mentor application |
| `mentor_profiles.user_id` | profiles | CASCADE | decide | a mentor with sessions, reviews or payouts cannot be deleted (three NO ACTION references and the counterparties' records): PR 3 decides what survives. Until then the account is blocked at request time for paid sessions and unpaid payouts |
| `mentorship_reviews.reviewer_id` | profiles | SET NULL | anonymise | the mentor's record too (0209) |
| `mentorship_sessions.mentee_id` | profiles | SET NULL | anonymise | the mentor's record too (0209); the mentee's own notes are nulled by trigger |
| `organization_members.user_id` | profiles | CASCADE | delete | the person's own link to an organisation (the organisation is kept) |
| `organizations.cac_confirmed_by` | profiles | SET NULL | detach | an admin's CAC confirmation |
| `organizations.created_by` | profiles | NO ACTION | block | PR 3 makes it nullable SET NULL: the organisation, its postings (closed) and applications are kept, only the owner's personal link is detached; an organisation other people belong to blocks deletion until ownership is handed over |
| `payment_transactions.user_id` | profiles | SET NULL | anonymise | tax and audit record (0209) |
| `proactive_match_alerts.user_id` | profiles | CASCADE | delete | alerts sent to the person |
| `profiles.id` | auth.users | CASCADE | delete | the profile itself |
| `profiles.referred_by` | profiles | NO ACTION | block | PR 3 sets it to null on the rows of people this person referred, before the delete |
| `referral_reward_events.referred_user_id` | profiles | SET NULL | anonymise | decides someone else's reward (0209) |
| `referral_reward_events.referrer_id` | profiles | SET NULL | anonymise | decides someone else's reward (0209) |
| `referral_shares.user_id` | profiles | CASCADE | delete | the person's own share log |
| `referrals.referred_user_id` | profiles | SET NULL | anonymise | the referrer's history must not shrink (0209) |
| `referrals.referrer_id` | profiles | SET NULL | anonymise | the referred person's row survives (0209) |
| `resume_builder_start_events.user_id` | profiles | CASCADE | delete | product analytics about the person |
| `resumes.user_id` | profiles | CASCADE | delete | resumes and cover letters |
| `scholarship_saves.user_id` | profiles | CASCADE | delete | the person's saved scholarships |
| `scholarships.moderated_by` | profiles | SET NULL | detach | an admin's moderation of a catalogue entry |
| `talent_directory_boosts.user_id` | profiles | CASCADE | delete | the person's own boosts |
| `talent_directory_contact_requests.candidate_id` | profiles | CASCADE | delete | requests addressed to the person |
| `talent_directory_contact_requests.requested_by` | profiles | SET NULL | detach | who at an organisation sent a request; the request stays |
| `talent_directory_waitlist.joined_by` | profiles | SET NULL | detach | who joined an organisation to the waitlist |
| `talent_portfolio_items.user_id` | profiles | CASCADE | delete | work samples |
| `talent_verifications.user_id` | profiles | CASCADE | delete | skills verification records |
| `test_user_pool.user_id` | auth.users | CASCADE | internal | test infrastructure (0188); absent from a real account |
| `user_notifications.user_id` | profiles | CASCADE | delete | the person's in-app notifications |
| `user_passes.user_id` | profiles | SET NULL | anonymise | tax and audit record (0209); renewal cancelled at confirm |
| `user_template_unlocks.user_id` | auth.users | CASCADE | delete | the person's unlocked resume templates |

## Storage

| bucket | path | class | note |
|---|---|---|---|
| `job-assessment-submissions` | `<applicant user id>/<posting id>/<file>` | delete | the applicant's own uploads: the purge deletes every object under their id before the account |
| `job-assessment-exercises` | `<organisation id>/<posting id>/<file>` | keep | an organisation's exercise files, not the person's |
| `job-banners` | `<organisation id>/<file>` | keep | an organisation's posting banners, not the person's |

Storage classes: `delete` (the person's objects, removed by the purge), `keep` (not the person's).
