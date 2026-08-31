# Talentrah Phase 1 — end-of-build summary

Required by build-prompt §11 and the plan doc's M10. First written 2026-08-24;
re-verified against `main` after PRs #17–#22; **last updated 2026-08-25 after a
forensic audit of the org-membership escalation** (see *Forensic audit* below),
which is also when the second route to the same privilege was found.

Milestone names below follow **the plan doc** (`~/.claude/plans/adaptive-giggling-ember.md`), not the PR labels — those diverged partway through, which is itself worth knowing (see *Numbering drift*).

## What shipped

| Plan milestone | State | Notes |
|---|---|---|
| **M0** Foundation & design system | done | Next.js/TS/Tailwind v4; six hand-built primitives; 22 tables, RLS enabled on every one |
| **M1** Auth & onboarding | done | Email/password + Google + LinkedIn OIDC; fictional testimonial persona (open decision #2 is a legal requirement, not polish) |
| **M2** Job supply & aggregation | **partial** | Greenhouse + Lever + one schema.org/JSON-LD source (Workable's aggregated search) live, with dedup and freshness sweep. Still one pilot source, not broad crawling — see *schema.org ingestion* below |
| **M3** Job feed & matching | done | Algorithmic match scoring, cached; server-rendered feed; manual apply both paths |
| **M4** Resume Builder | done | **11 templates across 11 industry categories**, drag-reorder, credit-gated AI bullet rewriting, print-to-PDF. **Template choice now genuinely changes the resume's appearance** — until Phase 2's template library all 7 original templates rendered identically, whichever was picked. See *Full template library* below |
| **M5** JD tailoring + Credits/Passes | done | Paste-text tailoring, one-time free trial, Paystack checkout + webhook, pass auto-renewal |
| **M6** Farah chat panel | done | Docked marginalia panel, quick actions, persisted history, one shared voice module |
| **M7** Job Tracker | done | Stage tracking, manual entries, Hired → referral prompt |
| **M8** Employer side | done (Phase 1 subset) | Org onboarding (create + join), Company Profile, job posting form, Jobs Posted with application counts. Free posting only — Ad Campaigns, billing and analytics are Phase 2 and are **omitted from the nav**, not stubbed. Building it surfaced a third policy hole (0028) |
| **M9** Refer & Earn | done | Two-step reward, share surfaces, anti-abuse |
| **M10** Cross-cutting polish | done | RLS verification, service-role audit, README, golden-path e2e all landed. Mobile/low-bandwidth payload check still not done |
| *(added later)* Scholarship Discovery | done | Not in the plan doc; added to build-prompt §6.15 mid-build |

## Numbering drift

The repo's PR labels stopped matching the plan doc partway through: "M8" shipped Refer & Earn (plan M9), "M9" shipped Resume Builder (plan M4), and "M10" shipped Scholarship Discovery — colliding with the plan's M10, *Cross-cutting polish & delivery*.

That collision is why two whole milestones went unnoticed as unbuilt: something called "M10" shipped, so the list looked finished. Worth fixing the labels or the plan doc before Phase 2 repeats it.

The employer side deliberately did **not** take a new milestone number. "M8" already means two different things in this repo, and a third label would make the drift worse rather than better; its branch is `feat/employer-side` and this document refers to it as *plan-doc M8* wherever it needs a name.

## Deferred, deliberately

- **The Phase 2 half of the employer product** — Ad Campaign Manager, employer billing, analytics, and the "claim your listing" flow. Phase 1's free job posting has now shipped; everything priced or measured has not.
- **Broader schema.org reliance** (M2) — one pilot source shipped (see below); relying on this mechanism as a *primary* supply source, or adding more sources without the same per-source diligence, is still blocked on the legal review §10 item 10 names.
- **Auto-apply, ad campaigns, URL-based JD import, mentorship, talent directory** — Phase 2/3 by design.

## Assumptions made where the founder hasn't decided

Each stands in for an open `[DECIDE]` item and should be revisited, not inherited:

| Assumption | Open item |
|---|---|
| Email verification gates Apply/Tailor, not browsing | §6.1 |
| Referral rewards: +20 signup / +50 activation / +20 welcome | #4 |
| Employer verification = work-email domain only | — (now **implemented as such**, see below) |
| 7 resume template categories | plan M4 |
| Paystack as the only rail | #7 |
| All pricing is a researched anchor, never tested | #18 |

**Resolved during the build:** §10 item 20 (scholarship geographic scope) — listing scope is eligibility-relevant, not geography-restricted.

## Known defects, not fixed

1. **`GEMINI_API_KEY` is a free-tier key** — 20 requests/day, and production is intended to run Gemini. A billed key is required before launch or AI features hard-fail almost immediately. Founder/account action, not a code change.
2. **`CRON_SECRET` presence in Vercel Production is unconfirmed**, and **no scheduled cron has ever fired**. Production runtime logs over the last 7 days contain three requests (`/` ×2, `/signup`), and no cron invocation at all — expected, since the crons were added mid-day and both run in the early-morning UTC window. First real opportunity is 06:00 UTC (`renew-passes`) / 07:00 UTC (`ingest-scholarships`) the following day. Confirm by looking for `[scholarship-ingest] cron run: ok=true` — a 401 or silence means it is still not working.
3. **There is no test or staging database, and no write-audit trail.** Every suite, plus `npm run seed`, runs against the one project that is also production. The suites clean up after themselves by convention, not isolation. Relatedly, there is no audit trigger on grant-shaped tables and no PITR, which is why the forensic question above can be answered strongly but not definitively. `0000_baseline_schema.sql` now makes a second project buildable; standing one up is the next step. (The schema-not-in-version-control half of this is fixed — see that file.)
4. **Six footer links are dead `#` anchors** for features that *do* exist. Not a truthfulness problem; a UX/SEO one.
5. **Groq's JSON mode intermittently 400s** on the largest JDs. Dev-only now — CI's e2e job runs the stub provider, and the large-JD path is exercised by `tests/tailoring/jd-truncation.test.ts` and a golden-path case.

### Fixed since the first draft of this document

- JD truncation at a silent, undocumented 8,000 characters → cap raised to a justified 24,000 with a visible notice (#19).
- `wasDegenerate` firing on every tailoring call, doubling real LLM spend through a key-order-sensitive JSON comparison (#15).
- `fulfillPayment` reachable with another user's transaction reference (#18).
- Legal/marketing copy describing unshipped features as live (#16).
- The pdf.js worker bug that fully blocked resume upload, plus the blank onboarding greeting (#21).
- OAuth signups left with a permanently `NULL` name (#22).
- Golden-path e2e — plan-doc M10's outstanding item — now standing in CI (#20).
- **Any signed-in user could publish a job into every user's feed under an invented company name** (`0027`, 2026-08-25). See *Second route to the same privilege* below.
- **A user could grant themselves unlimited credits** (`0030`, 2026-08-25). `profiles` is self-updatable with no column restriction, so `update profiles set credits_balance = 999999` succeeded — and that column is exactly what the credit gate reads before every paid AI action. Same for both free-trial flags, `referral_code`, `referred_by` and `email`. Found by the systematic pass that followed 0028; fixed the same way, verified the same way.
- **An organisation could mark itself verified** (`0028`, 2026-08-25). 0027 made `organizations.verified` the gate deciding whether an internal posting reaches the public feed, but never restricted who may *write* that column — and the `organizations` UPDATE policy is member-scoped with no column restriction. So one call (`update organizations set verified = true`) made the gate decorative, and the posting went public. Measured against the live project before the employer UI existed; found precisely because this was the first product code that would have walked through it. Fixed with column-level grants (table UPDATE revoked, then re-granted on the profile columns only) — note that revoking only the column would have looked right and changed nothing, because a table-level grant overrides it.
- **The demo account's password was committed in a public repo** while owning the org whose postings are live in the feed (2026-08-25). See *Published demo credentials* below.
- **A second published credential**, shared by the two seeded referral accounts, found by the follow-up history-wide sweep and still live at the time — rotated, old value confirmed dead. Full results in [docs/secrets-audit.md](secrets-audit.md).
- **Organisation-membership RLS, two defects, both live until 2026-08-24** (`0026`). Any authenticated user could `INSERT` themselves into **any** organisation with a caller-chosen role of `owner` — the policy checked only `user_id = auth.uid()` and never asked whether the caller had any relationship to the org (verified against the live project: HTTP 201, real row). Separately, the `organization_members` SELECT policy referenced its own table, so it — and every policy resolving membership through it (`organizations` UPDATE, `job_postings` INSERT/UPDATE) — failed with "infinite recursion detected in policy". The second masked the first: the escalation could not go anywhere because the downstream rules crashed before they could allow anything, so fixing the recursion alone would have switched it on. Both fixed together in one migration, with `tests/rls/org-and-referral-scoping.test.ts` proven to fail twice against the unfixed database and a positive control proving the legitimate path (create org → join → read → edit → post) still works.

## Forensic audit — was the org-membership escalation ever used?

Run 2026-08-25, after 0026 closed it. The question the fix cannot answer by
itself: the hole was open for the entire life of the `organization_members`
policy, so was it *used* before it closed?

**Finding: no evidence it was ever exploited, and the evidence available is
strong enough to say so — with one honest limit, stated below.**

What was checked, against the live project:

| Check | Result |
|---|---|
| Every `organization_members` row | Exactly **one**: the demo user, `owner` of Zaria Digital, an org that same user created 0.3s earlier. The seed script's signature, timestamp for timestamp. |
| Every `organizations` row | One — the seeded Zaria Digital, `updated_at` still equal to `created_at`, so never edited after creation. |
| Every internal `job_postings` row | Three, all created within 1.1s of the org, in the same seed run. The other 137 are external Greenhouse rows from the ingestion pipeline. |
| Lifetime table counters (`pg_stat_user_tables`, never reset) | `organizations`: 5 inserts / 4 deletes / 1 live — **reconciles exactly** (1 seed + 4 runs of the 0026 positive-control test). `organization_members`: 9 inserts / 8 deletes / 1 live, attributable to the seed row plus this session's own probes and test runs. |
| Every account that has ever existed | Seven. Demo seed user; the founder's Google account; two seeded referral personas; one disposable-email signup; two throwaway CI users. Only two ever had a session at all — `last_sign_in_at` is null for the rest, so they could not have made an authenticated request. |
| `auth.audit_log_entries` | Retained from the project's **first day** (2026-08-21 19:57) with no pruning — 1,275 entries. Every actor is accounted for as founder, demo, seeded, or test-harness. No unknown actor appears. |

**The honest limit.** There was never a write-audit trail on this table: no
audit trigger, no PITR on this plan, and Supabase's API logs retain one day. A
row inserted and then deleted leaves no record of itself. So the argument is
not "the log shows nobody did it" — it is that the current state is clean, the
lifetime insert counter is small enough to attribute, no organisation or
posting exists that does not trace to the seed, and the set of accounts that
ever held a session is fully known. A single detail slightly weakens the
counter argument: the audit log records *authentication*, not data writes, and
IP addresses are not captured (the field is empty for every entry), so a
stranger who signed in as the demo account would be indistinguishable from the
founder doing so. That mattered, because the demo password was published — see
below. Nothing in the data suggests it happened; it simply cannot be excluded
by log evidence alone.

**What would make a future answer definitive:** an audit trigger on grant-
shaped tables, or PITR. Both are worth having before the directory or employer
products carry anything valuable.

## Second route to the same privilege — found, and closed

0026 fixed one policy. Asking what *else* grants the same effective privilege
found a second route, reproduced end to end against the live project:

1. Any authenticated user creates an organisation named, say, "Paystack" → `201`, `verified: false`
2. Joins it as `owner` — legitimate, they created it → `201`
3. Inserts an `internal` job posting under it → `201`
4. A **different** signed-in user reads it back with the feed's own query → visible, company "Paystack"

Every step allowed by design; no policy bypassed. The gap was that
`organizations.verified` existed, defaulted to false, and was **read by
nothing**. So the feed would carry a posting — a phishing lure in the
reproduction — under a real company's name.

Worth stating plainly: **0026 is what made this reachable.** Before it, steps 2
and 3 died on the recursion bug. The recursion fix was correct and necessary,
and it removed the accident that had been standing in for a rule nobody had
written. `0027` is that rule: internal postings are visible to their own org's
members and, publicly, only once the organisation is verified — the same shape
as the existing scholarships moderation gate, enforced at the RLS layer so it
covers every reader rather than one page.

## Published demo credentials — rotated

This repo is **public**, and `demo@talentrah.dev`'s password was a literal in
`README.md`, `scripts/seed.ts` and an e2e spec. That account is the verified
owner of Zaria Digital, whose postings appear in every user's feed — so anyone
on the internet could sign in and rewrite them. 0027 does not touch this,
because the demo account is the *legitimate* owner; only rotation does.

Rotated 2026-08-25: `DEMO_PASSWORD` now comes from the environment with no
fallback default, the seed re-asserts it on the existing account on every run
(so rotating the variable actually rotates the account, rather than only the
docs), and the value is set in `.env.local` and as a CI secret. Verified: the
previously published password is now rejected by the live project, and the
masthead-nav e2e still logs in with the new one.

## Seed data for the employer side — deliberately unchanged

`scripts/seed.ts` was **not touched** by the employer build. It already creates
everything the surface needs: the demo organisation (Zaria Digital, verified),
a membership row making the demo user its owner, three internal job postings
under it, and applications against those postings — so application counts are
non-zero on first run. Signing in as the demo account and opening `/employer`
is a complete working employer, with no new seed writes.

That is the outcome to want, not a gap: CI runs `npm run seed` against the live
project (there is no staging database), so every line added there is a write to
production on every pull request. The safest employer seed was the one that did
not need to exist.

## Employer verification — what the badge actually means

Implemented exactly as CLAUDE.md's assumptions table records it, and no further:
a company is verified when the person who created it has a **confirmed** email
address at the domain they claimed, and that domain is not a consumer mailbox
provider. Nothing else — no DNS proof, no postmaster round-trip, no manual
review.

**This is still an assumption standing in for an open founder decision, not a
decision that was made.** It proves someone can receive mail at that domain. It
does not prove they speak for the company — any employee, or anyone who can get
an address there, clears it. The Company Profile page says so in those words
rather than letting a green badge imply more.

Two things make it load-bearing rather than cosmetic: an unverified company's
postings never reach the public feed (0027), and a company cannot mark itself
verified (0028). Verification only ever happens server-side, from the session
user's own confirmed email.

## Column-privilege audit — 2026-08-25

The systematic version of what 0028 found by accident. **RLS row policies decide
which rows you may touch; they say nothing about which columns.** Supabase grants
`ALL ON ALL TABLES` to `authenticated` by default, so every table with a
permissive UPDATE policy let its owner rewrite *every* column on their own row.
The row being yours does not make every column on it yours.

Every table where RLS permits an authenticated UPDATE, probed with a real
session against the live project:

| Table | Verdict |
|---|---|
| **`profiles`** | **WAS EXPOSED — fixed in `0030`.** `credits_balance`, both `free_trial_*` flags, `referral_code`, `referred_by`, `email`, `market_segment` were all user-writable. |
| **`organizations`** | Already fixed (`0028`). Re-asserted by the standing suite. |
| `match_scores` | **Closed (`0031`).** A user could write their own `score`/`tier`; writes now go through the service role. |
| `job_tailoring_requests` | **Closed (`0031`).** Traced first: nothing reads `is_free_trial`/`credits_spent` back, so it was never exploitable — locked anyway, since a log its subject can rewrite is not evidence. |
| `applications`, `resumes`, `farah_messages`, `referral_shares`, `scholarship_saves` | Correct — these are the user's own content, and every column on them genuinely is theirs. |
| `job_postings` | Correct — the 0027 `WITH CHECK` pins `source_type` and org membership on both sides of an update. |
| `credit_ledger`, `payment_transactions`, `user_passes`, `referrals`, `organization_members`, `application_stage_events`, `credit_gate_events` | Correct — **no UPDATE policy at all**, so RLS denies before column privileges are consulted. Verified live, not inferred: a user could not rewrite a ledger entry, mark their own payment successful, reactivate an expired pass, inflate a referral reward, or promote their own org role. |

`credits_balance` was the serious one. `src/lib/credits/spend.ts` reads it as the
authoritative balance before every paid AI action, so one `PATCH` bought
unlimited tailoring, cover letters and bullet rewrites — real model spend. The
schema comment on that column already said *"do not write to this column
directly"*, which is the whole lesson: it was documented as a rule and enforced
as nothing.

`tests/rls/column-privileges.test.ts` now asserts each of these per column, with
positive controls that a user can still edit their own name and an employer can
still edit their own company profile.

Both open items were closed in `0031`, in the pass immediately after. The
`match_scores` one mattered more than its impact suggested: self-set scores are
cosmetic while only the feed reads them, but Phase 2's Auto-Apply is specced to
gate on a match threshold — CLAUDE.md names that gate as one of the three things
separating Talentrah from spam auto-apply competitors. A user-writable score
would have been a user-writable trigger for applications sent under their name.
Fixed while it was cheap rather than discovered when Auto-Apply shipped.

## Grants sweep: `anon` reach and SECURITY DEFINER functions — 2026-08-25

The second mechanism the column audit named as unexercised. Enumerated every
function and then tested what a signed-out client can actually do, rather than
reading grants and reasoning about them. **Two wrong grants, in opposite
directions.**

**A live regression, introduced by `0027` and fixed in `0032`.** That migration
revoked `EXECUTE` on `is_org_member` from `anon` as tidy-up — reasoning about
who should *benefit* from the function, and missing who has to *evaluate* it.
Its own policy is:

```sql
create policy "job postings are publicly readable" ... for select
  using ( source_type = 'external' or <org verified> or is_org_member(...) )
```

No `TO` clause, so it applies to `public` — anon included — and Postgres
evaluates the whole expression as the calling role. Measured:

```
anon select from job_postings         -> ERROR: permission denied for function is_org_member
anon select from organization_members -> ERROR: permission denied for function is_org_member
```

Two tables RLS declares publicly readable, erroring outright for the public.
Nothing user-facing broke only because the landing page's job preview is
hardcoded sample copy rather than a query — so it would have surfaced as a 500
on the first public job page, sitemap or "claim your listing" flow. Restored,
and `tests/rls/column-privileges.test.ts` now has the regression guard that
would have caught it, asserting on the *error* and not just the row count.

**The generalisable rule, since this one is easy to repeat:** if an RLS policy
calls a function, every role that evaluates that policy needs `EXECUTE` on it —
including `anon`. Revoking looks like hardening and is a denial-of-service on
your own public surface.

`generate_referral_code` was the other direction: the one function still
carrying Supabase's default `PUBLIC, anon, authenticated` grant. `SECURITY
INVOKER`, so it leaks nothing, but it is an unauthenticated RPC endpoint that
loops a query against `profiles` until it finds an unused code, and nothing in
the app calls it. Revoked; signup still works, because its only caller
(`handle_new_user`) is `SECURITY DEFINER` and runs as its owner.

Everything else came back correct: all eight other definer functions are
`postgres, service_role` only, `org_application_counts` is `authenticated` as
intended, and a signed-out client sees **zero rows on every owner-scoped
table** while the public catalogs (`credit_packs`, `passes`,
`resume_templates`, `job_postings`, `organizations`) stay readable. The
advisor's GraphQL-exposure warnings on all 22 tables are discoverability of the
schema, not data: the owner-scoped policies compare `auth.uid()`, which is null
for anon, so they return nothing.

## Referral activation — a real payout for an invented job

Tested directly, because the question was whether server code re-verifies
anything before a referral reward is granted. **It does not.**

What actually happens: a referred user logged a manual Job Tracker entry for
*"Entirely Invented Ltd — Chief Nobody"*, a company and role that do not exist,
marked it hired, and the referrer's ledger went from

```
[ referral_signup_bonus +5 ]        ->        [ referral_signup_bonus +5, referral_activation_bonus +20 ]
```

Two corrections to the obvious reading, both from the code rather than the
symptom:

1. **`stage = 'hired'` is not the trigger.** The `applications_check_activation`
   trigger fires on `INSERT OR UPDATE OF applied_at`, and
   `check_and_activate_referral` treats activation as *"has a base resume OR has
   an application with `applied_at` set"*. Any stage above `saved` sets
   `applied_at`. `hired` only drives a UI banner (`tracker-actions.ts`). The
   exploit is therefore **cheaper** than the hypothesis — uploading a résumé
   alone is enough.
2. **This is the documented rule, correctly implemented** — the plan doc defines
   activation as *"completed profile OR first application"*. It is a weak
   definition, not a broken gate. Nothing verifies a real `job_posting_id`, a
   real employer, or a non-manual `source`.

What actually limits it: self-referral detection (email normalised for dots and
`+` suffixes) and a **cap of 10 rewarded referrals per referrer per 30 days**
inside `grant_referral_reward`. So the ceiling is 10 × 20 + 10 × 5 = **250
credits per referrer per 30 days** — roughly ₦37,500 at the researched anchor —
for the cost of ten confirmable email addresses.

**Left open deliberately, and named:** tightening this means changing what
"activated" means, which is a referral-economics decision (open item #4), not a
privilege fix. The narrow version, if wanted, is to require the activating
application to have a real `job_posting_id` — that keeps the documented rule
while making the application half mean a real job.

## Verification actually performed

Re-run together on `main` on 2026-08-24, not just per-PR in isolation:

- **Typecheck + lint** — clean.
- **Vitest — 86 tests across 8 files on `main`** — all passing. Includes the RLS cross-user gate (`tests/rls/cross-user.test.ts`: two real authenticated users, 13 owned tables, reads *and* writes, proven to fail when RLS is weakened), the new org-membership/referral suite, the `fulfillPayment` scoping regression, resume sanitisation, and the tailoring retry heuristic.
- **Playwright, 8 e2e specs** — all passing, including the golden path (browse → apply → track → tailor → spend credits → refer) against the real routes with only the model stubbed.
- **Service-role scoping** — all 17 `createServiceRoleClient()` call sites re-inventoried on current `main`. No new call site since the #18 audit; one site *removed* (a dead `sendDeadlineReminderEmail` that took a `userId` and was pre-shaped for the same bug). Every `userId` reaching a service-role query is still derived from `auth.getUser()` or `getAuthedUserId()`.
- **Employer surface** — `tests/employer/employer-flow.test.ts` (two real authenticated users) covers create org → join → post → the 0027 feed gate → self-verification refused → outsider cannot join, escalate, post, edit or read member lists → application counts scoped to members and aggregate-only. `tests/employer/verification.test.ts` covers the domain rule without a database. `e2e/employer.spec.ts` drives the real screens. Positive controls throughout, including that the gate *opens* once verified — every negative assertion here would also pass under a system that refuses everyone, which is exactly what 0026's recursion bug looked like.
- **Table coverage** — all 22 public tables have RLS enabled, and every user-scoped table now has a standing test. 14 carry a `user_id`; 13 are in the cross-user suite's `OWNED_TABLES`. The fourteenth is `organization_members`, and `referrals` is user-scoped through `referrer_id`/`referred_user_id` with no `user_id` column — the two gaps that hid the org escalation. Both are covered by `tests/rls/org-and-referral-scoping.test.ts`.
- **Secrets sweep across the whole git object database** (not just `HEAD`, and including blobs orphaned by amends) — 414 blobs, provider key shapes plus a high-entropy pass. Two real live credentials found and rotated; no `.env` file was ever committed; nothing else in history is currently valid. See [docs/secrets-audit.md](secrets-audit.md).
- **Schema in version control** — `supabase/migrations/0000_baseline_schema.sql` snapshots the live schema (tables, indexes, functions, grants, triggers, RLS, every policy) so future policy changes are reviewable in a diff. Migrations 0001–0025 had never been committed, which is how two broken policies survived Phase 1 without appearing in any review.
- Live end-to-end payment verification: real Paystack test-mode purchases on card and bank rails, plus a real scheduled pass renewal.
- Real measured LLM unit economics (`npm run estimate-costs`) — every credit action clears ~98–99% margin.
- Moderation gate verified at the database layer, and again through an authenticated client in the RLS suite.

**Not performed:** a mobile/low-bandwidth payload check (plan-doc M10, still outstanding), and confirmation of a real cron firing (defect #2).

## Standing caveats

- **The LinkedIn half of the OAuth name fix is unverified against a real account.** It was built from LinkedIn's published OIDC userinfo schema and a test fixture, because no LinkedIn account exists in this project. Google's half came from this project's own real `auth.users` metadata. Check the LinkedIn path the first time a genuine LinkedIn signup happens — the two providers really do send different shapes, so a Google-only confirmation proves nothing about it.
- **Tests run against the live Supabase project.** There is no separate test project. The suites create namespaced throwaway users and clean up after themselves, but a dedicated project or Supabase branch is worth setting up before this repo has more contributors.

## Internal API contract layer (0038 + `src/lib/api/`)

Five admin routes each rolled their own auth guard and the guards disagreed.
All five used the fail-open shape `if (secret) { ...check... }`, so an unset
env var meant no check at all. `INGEST_SECRET` was not set on the deployment,
which made every one of them reachable unauthenticated on the public internet.
Verified against production before the fix, not inferred:

(`moderate-scholarship` has since been retired in favour of `/admin/scholarships`
— the transcript is the evidence for the finding, not a live URL.)

```
$ curl https://claude-talentrah.vercel.app/api/admin/moderate-scholarship
{"count":3,"scholarships":[{…"moderation_status":"pending"}…]}   HTTP 200

$ curl -X POST '…/api/admin/estimate-llm-costs?group=bogus'
{"error":"group must be one of tailoring, bullet, scholarship"}  HTTP 400
```

The second is the proof: argument validation sits behind the auth check, so a
400 rather than a 401 means the guard never ran.

Exposed by that: the scholarship moderation queue (GET listed unpublished
rows; POST could publish any listing to the public catalog), the job-ingestion
trigger, and the LLM-cost probe, which spends real model budget per call.

`/api/admin/renew-passes` POST — the one route that charges saved Paystack
tokens — was gated on a **fourth** env var, `PASS_RENEWAL_SECRET`, that nothing
else read and that `.env.example` documented only in passing. An operator who
set the documented `INGEST_SECRET` would have secured four routes and left the
money-spending one open. It was **not** probed: there is no safe request to
make against it, so its state in production is inference, not measurement.

Now: one fail-closed, timing-safe guard in `src/lib/api/admin-auth.ts`,
`PASS_RENEWAL_SECRET` retired, `x-admin-secret` the header going forward with
the two legacy names still accepted. **Unset `INGEST_SECRET` now 401s the whole
admin surface** — that is the point, and it means the variable has to be set on
the deployment before the manual triggers work again.

Also in this pass:

- **Rate limits on the two paid routes.** `/api/farah/chat` had a per-hour cap
  since it shipped; `/api/tailoring` and `/api/resume/parse` had none. The
  credit gate bounds spend, not burst. Migration 0038 adds an atomic counter
  (`consume_rate_limit`) — proven necessary: a read-then-increment variant let
  **20 of 20 concurrent requests through a limit of 5**, the real one lets
  exactly 5.
- **Raw `err.message` no longer reaches any response body.** Four handlers
  echoed driver text; one returned a Postgres constraint name verbatim
  (captured in the test file's header).
- **`await request.formData()` guarded** in `/api/resume/parse`. It rejects on
  a truncated multipart body, which a dropped mobile connection produces
  routinely on this app's target network.
- **Job ingestion is now actually scheduled** (`0 5 * * *`). Its own comment
  said "point a Vercel Cron job at this" and nothing ever did. Ingestion is
  heuristic-only — no LLM call anywhere under `src/lib/jobs/` — so a daily run
  costs no model budget.

**Not a finding, checked and dismissed:** the "no 405 on unsupported methods"
concern. Next.js already returns 405 for a method a route doesn't export.
Confirmed on production rather than from the docs alone — `GET`, `PUT`,
`DELETE`, `PATCH` on `/api/admin/ingest-jobs` all returned 405 before any
change. `/api/e2e/llm-provider` likewise already self-gates correctly, 404 on
production. Both are covered by tests now, but neither needed a code change.

## An empty fetch could wipe a source's live postings (PR #47)

The freshness sweep closes "anything I did not just see" — which is *everything*
when the fetch returned nothing. A board answering 200 with an empty array
closed every posting for that source; the next run reopened them, so the damage
was a window rather than permanent, but during it the feed was missing real jobs
and nothing reported it.

Documented in `ingest.ts`'s own comment since the Greenhouse days, pointing at a
brief that is not in this repo — a fair part of why it stayed unfixed. PR #39
then widened the blast radius: a schema-org source closes by source, so one
empty listing page took out every employer on it.

**The rule is "any open postings", not a threshold.** A source that genuinely
emptied and one that glitched both return zero and are not distinguishable from
here; the only difference is what we already hold. A source that is supposed to
be empty has nothing open and is a silent no-op.

**Surfaced, not silent** — `closed: 0` is also what a healthy run looks like, so
the skip is reported via `IngestSourceResult.closureSkipped`, a warning naming
the source and the count it protected, and a `⚠` in seed output.

Both closure paths covered and separately tested; the company-scoped path was a
gap in the first round of tests, found and closed before merge.

## Names must render at least one visible character (0045)

`signUpSchema` validated `firstName`/`lastName` with
`z.string().trim().min(1)`. Two problems, and only the second mattered.

`.trim()` strips the ECMAScript WhiteSpace production — spaces, tabs, NBSP and
U+FEFF — but not the zero-width FORMAT characters (category Cf, not Zs). A lone
U+200B passed `.min(1)`, satisfied every `first_name?.trim() ? …` guard, and
rendered as blank everywhere, reopening the defect PR #21 fixed. *(The brief's
U+FEFF example was already handled; the real offenders are U+200B/200C/200D,
U+2060, U+180E.)*

**But the schema was never on the write path.** `0030` grants
`update (first_name, last_name, …)` to `authenticated`, so a client PATCHes the
column and never runs application code — confirmed live: U+200B, U+2060 and a
plain space all wrote successfully. Same class as 0028/0030/0031/0041.

The gate is therefore `0045`'s CHECK constraint, with NULL allowed explicitly
(the normal pre-onboarding state) and a fail-loud pre-check naming any row that
would violate it. Six call sites now share one helper — three of them never
trimmed at all, including the Pass renewal email sent to paying customers.

The JS and SQL character classes are **deliberately asymmetric**: Postgres `\s`
does not cover U+FEFF while JS `.trim()` does, and the first version disagreed
on exactly that, accepting a BOM-only name the JS helper rejected. The invariant
is identical accept/reject behaviour, asserted case by case, not literal list
equality.

## Two organisations could split one company's domain (0044)

`createOrganizationAction` inserted with no check for an existing org at the
claimed domain, while onboarding's joinable list only offers orgs where
`verified = true`. Person A creates an org that isn't verified; person B at the
same company sees an empty list and creates a second one. Colleagues end up in
disconnected companies with postings and analytics split, and no merge path.

**Why the obvious fix would have been worse.** A bare `unique (domain)` looks
right until you ask what an unverified org is. Production holds one:
`Fatishcakes`, claiming `fatishcakes.com`, created by a **gmail.com** user — so
`evaluateDomainVerification` can never verify it and it holds the domain
forever. Under that constraint the genuine employer could neither create (index
rejects) nor join (`joinOrganizationAction` refuses unverified orgs,
server-side). Locked out entirely, and squatting becomes trivial: one free
mailbox denies any company its registration.

**The rule:** verification establishes the claim — that is what 0027/0028 are
for — so only a verified org owns a domain. `0044` is a partial unique index on
`(lower(domain)) where domain is not null and verified`, plus an app-layer
pre-check and a `23505` race handler that rolls back rather than leaving an
unverified duplicate squatting the domain.

Verified live after merge, in a rolled-back transaction: a fresh domain still
creates and verifies, and a verified org can still be created alongside the
unverifiable squatter.

## Dedup key collisions silently discarded apply links (PR #44)

**Not a hash collision — the key was not specific enough.**
`computeDedupFingerprint` hashes `company | title | location`, and
`job_postings.dedup_fingerprint` is UNIQUE table-wide, so any two postings that
canonicalize alike *are* the same job to this system.

The cost was the apply link. `external_url` is per-posting, and `ingest.ts`
collapsed each batch with `new Map(fetchedJobs.map(j => [j.dedupFingerprint, j]))`
— last-one-wins. Every colliding posting but one was discarded along with its
URL, while `IngestSourceResult.upserted` counted the survivors, so **the number
looked correct however many jobs had been lost**. A seeker would see a real
posting and be sent to a different requisition, or nowhere.

**Measured before assuming, and the framing needed correcting.** Against
Moniepoint's live board: 127 postings, 127 distinct fingerprints, **0 dropped**,
and no company under two `external_source` values. The mechanism is real; it was
not firing. This pins the behaviour and makes it visible rather than fixing an
active outage.

**The fix, and the thing it must not break.** Colliding postings are
disambiguated by URL rather than dropped, keyed stably so the upsert updates
instead of inserting a fresh row each run. Cross-source dedup is *the feature* —
one job on both an ATS board and an aggregator should collapse to one row — and
a naive "make the key more specific" fix would have destroyed it. Disambiguation
is safe only because it runs within a single fetch, which by construction holds
one source's postings; a collision there is two requisitions, a collision across
sources is one job. Pinned by a test.

**Deployment risk checked against production, not asserted.** Fingerprint drift
would have re-inserted every posting and let the freshness sweep close the
originals, churning the whole external feed. Ran the real algorithm over the
live board: 127 updates, **0 inserts**.

**The trade-off is in the code.** A board that genuinely lists one role twice now
shows two entries. Accepted because a visible duplicate is a smaller harm than a
job the seeker never learns exists.

`IngestSourceResult.collided` plus a run log and seed output make it
discoverable if it ever does fire — which was the actual gap.

## A Paystack outage could cancel a paying subscription (0043)

> **A different kind of entry from the ones above it.** 0041 was an
> unauthorized bypass and 0042's premium-template gap was a product-integrity
> defect — both had an unambiguous right answer once the facts were established.
> This one did not. The bug was clear-cut, but the *remedy* required three
> financial-policy judgment calls with real trade-offs in both directions, and
> the reasoning behind each is recorded below because a future reader changing
> one of them needs to know what was weighed, not just what was chosen.


**A real money-affecting defect, live until this shipped.** `chargeOne` in
`src/lib/billing/renewals.ts` caught every failure from `chargeAuthorization` in
one branch whose comment asserted a single cause — *"Paystack rejected the
charge outright"* — for every possible one. A timeout, a DNS failure, a reset
connection and a 502 from Paystack's own edge all landed in the same place as a
genuine "card declined", and that branch calls `markLapsed`:

```
auto_renew: false, auto_renew_status: 'lapsed', next_renewal_date: null
```

`next_renewal_date: null` is what makes it permanent — the job's work-list query
is `next_renewal_date <= today`, so a lapsed Pass is never looked at again, and
the design deliberately has no dunning to undo it. **One dropped connection
ended a subscription the customer was paying for and had done nothing to lose.**

Demonstrated before it was fixed, driving the real job against the real
database with only the Paystack client mocked:

```
× a timeout leaves the Pass renewable and retries on the next run
  AssertionError: SUBSCRIPTION KILLED BY A NETWORK BLIP: a timeout lapsed a
  paying customer's Pass: expected 'lapsed' to be 'active'
```

**Two corrections to how this was originally described**, both of which change
what the fix had to preserve:

* `markLapsed` does **not** clear `authorization_code` — only
  `cancelPassAutoRenewal` does. The stored token survives a false lapse, so
  recovery was possible in principle; what was destroyed was
  `next_renewal_date`, which is what removed the Pass from the job forever.
* But the run also wrote a `payment_transactions` row with `status: 'failed'`,
  and **that is a claim Talentrah cannot support.** A timeout can happen after
  Paystack has already debited the card. Recording "failed" for a charge that
  may have succeeded is how a customer gets debited and cancelled in the same
  run, and it is the record a human would later use to decide what happened.

### The policy, and why

* **A genuine decline still lapses on the first attempt.** Unchanged and
  deliberately so — a reasoned call from the original renewal build ("no
  retry/dunning, a single failed attempt is enough"). Reversing it while fixing
  something else would be a larger change than the one needed. A positive
  control test pins this so declines cannot accidentally become unkillable.
* **An indeterminate failure does not lapse.** The Pass keeps
  `auto_renew_status = 'active'`, its `authorization_code`, and a non-null
  `next_renewal_date`, so the next daily run retries. Retrying *is* the recovery
  mechanism; there is no dunning queue and no operator alert, so if the next run
  does not pick it up, nothing ever will.
* **Bounded, not infinite** — `MAX_INDETERMINATE_RENEWAL_ATTEMPTS = 3`, roughly
  three days of grace at a daily cron. Paystack incidents run minutes to hours,
  so a failure unresolved after three daily attempts is no longer plausibly
  transient, and continuing to promise a renewal that never happens is its own
  dishonesty.
* **Double-charge prevention, which matters most.** An indeterminate attempt
  stores its `pending_renewal_reference`. The next run **verifies that reference
  before charging again** — if the timed-out charge actually succeeded, the Pass
  is extended from it and no second charge is made. Billing a customer twice for
  one period would be strictly worse than the bug being fixed.

### The predicate is `isDecline`, not `isIndeterminate` — deliberately

Only an **affirmative** decline lapses. The first version of this fix asked "does
this error look like a network problem?", which meant an error the module had
never seen — a bug in a future call path, a raw `TimeoutError` escaping from
somewhere new — still fell through to cancelling the customer. That is the
original bug wearing a new shape. Asking instead "do we have positive evidence
the card was refused?" makes evidence-of-nothing safe by default, and makes
reintroducing the old behaviour require an explicit, visible decision.

### The three judgment calls, and what was weighed

**1. Three attempts, not one and not unlimited.** One attempt is what caused the
bug. Unlimited leaves a Pass promising a renewal that never arrives, against an
endpoint that never answers — a different lie to the customer, and one with no
natural end. Three daily attempts is roughly three days of grace: Paystack
incidents run minutes to hours, so a failure still unresolved after three is no
longer plausibly transient. The number is a judgment, not a derivation, and it
is a single exported constant (`MAX_INDETERMINATE_RENEWAL_ATTEMPTS`) precisely
so changing it is a one-line, visible decision.

**2. Verify before re-charging.** The non-obvious risk in "just retry" is that a
timeout can happen *after* Paystack has debited the card. A naive retry would
bill the customer twice for one period — strictly worse than the original bug,
because the original at least only withheld a service, where this takes money.
So an indeterminate attempt stores its reference and the next run verifies that
reference before charging. If the verify is itself indeterminate the run backs
off entirely rather than gamble.

**3. Safe-by-default classification — `isDecline`, not `isIndeterminate`.** The
predicate asks "do we have positive evidence the card was refused?" rather than
"does this error look like a network problem?". The direction is the whole
point: under the second phrasing, an error the code has never seen falls through
to cancelling the customer, which is the original bug wearing a new shape. Under
the first, evidence-of-nothing is safe and reintroducing the old behaviour
requires an explicit, visible change.

This was not theoretical. The first implementation used the `isIndeterminate`
phrasing and **the timeout test still failed** — the fix was wrong in exactly
the direction it was meant to correct, and only the test caught it.

### Two bugs found in the work itself, not in the product

Recorded rather than folded into the fix, because both are recurring classes in
this repo rather than one-offs:

* **A test fixture that silently retargeted its assertions.** The suite minted a
  fresh auth user per test with a raw `admin.auth.admin.createUser`. Under
  full-suite load that call trips Supabase Auth's rate limit, and when it threw,
  the module-level `userPassId` kept the *previous* test's value — so assertions
  ran against the wrong Pass, producing "expected 1 transaction, got 2" and a
  missing retry reference. Intermittent, passing in isolation, and it looked
  exactly like a product bug. This is the **third** fixture bug of the
  looks-like-a-product-bug-but-isn't class in this run, after PR #38's `afterAll`
  that leaked the accounts it existed to delete and PR #39 review's `ledgerFor`
  reporting a failed query as an empty result. The shared, retrying helper in
  `tests/support/auth.ts` exists for exactly this; the fixture now uses it, holds
  one account for the whole file instead of seven, and resets its target to a
  sentinel so a partial setup fails loudly.
* **The CI secret scanner reported its own tooling failure as a leak.** gitleaks
  failed to download (a 403 from GitHub's release CDN), the step exited non-zero,
  and a bare `if: failure()` printed *"A secret-shaped value was found in this
  change."* That was untrue. The message is now scoped to the scan step, the
  download retries, and a separate notice states the thing that actually matters
  when the tool cannot run: **nothing was scanned, so nothing was cleared** — a
  green PR must not be read as evidence the change was checked. A security check
  that cries wolf on its own infrastructure is one people learn to dismiss, which
  is a problem independent of this PR.

### Also fixed: the last untimed external call in the repo

All three `fetch` calls in `src/lib/paystack/client.ts` (`initializeTransaction`,
`verifyTransaction`, `chargeAuthorization`) had **no timeout**, so a hung
connection blocked until the platform killed the function — on the renewal cron
that means every remaining Pass in the batch goes unprocessed. They now route
through a single `paystackFetch` with `AbortSignal.timeout(15_000)`, the same
budget PR #39 established in `src/lib/jobs/sources/schema-org.ts`. **That closes
the "no external call anywhere sets a timeout" gap the backlog named** — these
were the last ones.

`initializeTransaction`'s and `verifyTransaction`'s callers were checked and
needed no change: `billing/actions.ts` already catches everything (and no charge
has happened at initialize time), and `fulfill.ts` leaves the transaction
`pending` when verify throws, which was already correct.

**Not a 0041-class column addition**, checked rather than assumed: `user_passes`
has RLS enabled with exactly one `SELECT` policy and no write policy, so a client
cannot write the three new columns regardless of the table-wide grant — the row
policy refuses first.

## Full template library — templates used to be visually identical (0042)

**Stated plainly because the previous state was worse than "unfinished":** until
this shipped, choosing a template changed nothing you could see. All seven rows
in `resume_templates` differed only in `name`, `industry_category`, `is_premium`
and `unlock_cost_credits`. Every resume rendered through the single
`ResumeDocument` component — `resume-builder/preview/page.tsx` did not even
`select` `template_id`. The gallery was selling a label.

Two of those seven were **premium at 10 credits** (Portfolio Grid, Pipeline). A
user could spend credits to unlock one and receive precisely the free layout.

**This is a product-integrity defect, and deliberately not described in the
language used for 0041.** The two are different failure modes and conflating
their severity would be misleading in both directions:

* **0041** was an *unauthorized bypass* — a user taking something they had not
  paid for and were not entitled to, by writing a column the server never
  intended them to touch. The wronged party was Talentrah.
* **This** is the inverse. The unlock worked exactly as designed: credits were
  spent, `user_template_unlocks` was written, the entitlement was real and
  correctly recorded. What the user received was a template that was
  *contractually theirs* but **visually indistinguishable from the free ones**.
  Nothing was bypassed and no control failed. The wronged party was the user,
  who paid for a difference that did not exist.

It is not a security finding and does not belong in the 0028/0030/0031/0041
running count. It is a promise the product did not keep, which is why it was
fixed in this pass rather than deferred: both templates now have real layouts,
and `tests/resume-builder/template-registry.test.ts` fails if any premium
template ever resolves to the free default again — an assertion with no
exemption list, unlike the free-template one.

**The catalog is now 11 templates across 11 industry categories** — one per
category, no overlaps. The seven originals cover Business, Administration,
Technology, Design, Customer Success, Banking & Finance and Sales & Marketing.
The four new ones:

| Template | Category | Why this category |
|---|---|---|
| Clinical | **Healthcare** | Present on both Resume-Now's and Enhancv's real category lists; the largest professional segment the catalog had no entry for |
| Statute | **Legal** | Same — a standard category on both, and one where layout convention carries real signal |
| Critical Path | **Project Management** | **Enhancv's single most-popular category.** If one addition is going to be used, it is this one |
| Public Record | **Government & Public Sector** | The deliberate pick: **a large segment neither competitor targets.** Public-sector hiring is a major employer in Nigeria, so this is a fit for a Nigeria-first product that a US-centric taxonomy would not suggest |

Categories were taken from Resume-Now's and Enhancv's actual published
taxonomies and deduped against the existing seven, rather than invented — the
point was to add categories real job seekers already look for, with one
deliberate departure where the competitor lists have a gap our market does not.

**What shipped**

- **`slug` as the join key** (migration `0042`) — `text not null unique`,
  backfilled for the original seven. The component registry keys off `slug` and
  nothing else: `name` is editable catalog copy with no unique constraint, so
  keying on it means a rename silently unmaps a layout with no error anywhere;
  `id` is a per-environment uuid and could not be committed to source.
- **A component-per-template registry** at
  `src/components/resume-builder/templates/`. Visual-only differentiation —
  layout, density and typography change per profession, the `StructuredResume`
  shape does not. A resume saved under one template renders unchanged under any
  other, which makes switching a reversible choice rather than a data
  migration. This is also how Resume-Now and Enhancv actually differentiate.
- **Four new templates**, deduped against the existing seven and taken from
  those competitors' real category taxonomies: Clinical (Healthcare), Statute
  (Legal), Critical Path (Project Management — Enhancv's most popular category),
  and Public Record (Government & Public Sector — deliberately chosen as a large
  segment neither competitor targets, and a natural fit for a Nigeria-first
  product). Three of the four are premium; the catalog was 5-of-7 free, which
  left the credit-unlock mechanic with almost nothing to sell.
- **Preview wired through** — the page now selects `template_id`, joins
  `resume_templates(slug)`, and renders the matched component. The editor has no
  preview pane (only a link), so it needed no change.

**Known and bounded:** four *free* templates (Structured Admin, Product & Tech,
Field Notes, Ledger) still render as clean-professional. That list lives in
`KNOWN_UNSTYLED_FREE_SLUGS` in the registry test, which enforces that it may
only shrink and may never contain a premium template.

**Not an instance of the 0028/0030/0031/0041 column class**, checked rather than
assumed: `resume_templates` is catalog data with RLS enabled, exactly one
`SELECT` policy and no write policy at all — so a write is refused by the row
policy before the table-wide grant is consulted, the opposite arrangement to
`resumes`. `slug` carries no trust, money or identity. `column-privileges.test.ts`
now asserts this directly: a user cannot flip `is_premium`, zero
`unlock_cost_credits`, rewrite a `slug`, or insert a catalog row.

## Premium-template paywall was bypassable in production (0041)

> **Running count: this is the sixth and seventh instance of the same class.**
> 0028 (`organizations.verified`), 0030 (`profiles.credits_balance` and the
> other value columns), 0031 (`match_scores`, `job_tailoring_requests`), and now
> 0041 (`resumes.template_id`, `farah_messages.created_at`/`role`). Every one was
> found by the same sweep, and every one had been sitting in production
> unnoticed. The pattern is not "we keep making this mistake" so much as
> "Supabase's default `GRANT UPDATE ON ALL TABLES` makes it the default state,
> and only an explicit column grant takes a table out of it." At this point the
> prior should be that **any new user-writable table is exposed until proven
> otherwise** — `tests/rls/column-privileges.test.ts` is the standing check, and
> adding a value-bearing column to a user-writable table should fail it until
> someone decides, deliberately, which side of the line that column is on.


**This reached production as a live, exploitable gap.** Until 0041 landed, any
signed-in user could apply any premium resume template for free, and separately
could reset their own Farah LLM spend cap. Both were confirmed against the
production project with a real authenticated session before being fixed — not
reasoned from the schema.

The fifth and sixth findings in the class 0028/0030/0031 opened: an RLS policy
decides which *rows* you may touch and says nothing about which *columns*, while
Supabase grants `UPDATE ON ALL TABLES` to `authenticated` by default.

**`resumes.template_id`.** The table carries a correct owner-only policy
(`for all using (auth.uid() = user_id) with check (...)`) and had never had a
column grant applied. `template_id` points at `resume_templates`, whose
`is_premium` rows cost credits via `unlockTemplateAction` — which checks
`user_template_unlocks` and calls `spendCredits`. A client writing the column
directly reaches none of it:

```
premium template: Portfolio Grid (costs 10 credits)
unlocks owned: 0   credits: 0
update error: none
template_id now: 7704054a-6c90-40b6-a977-ef6e2e1c404f
=> BYPASSED — premium template applied, 0 credits spent
credits after: 0 (unchanged = never paid)
```

**`farah_messages.created_at` / `role`.** Found by the "what else grants the
same privilege" sweep this repo makes standard after a policy fix. `/api/farah/chat`
caps a user at 30 messages an hour as a cost safety net on unbounded LLM spend,
and counts its own rows by `role='user'` and `created_at`. Both columns sat
inside the same unrestricted owner-only grant, so the counter was writable by
the thing being counted:

```
counted toward the 30/hr cap: 1
backdate error: none
counted after backdating: 0
=> BYPASSED — quota reset, unlimited paid LLM calls
```

**Fixed in `0041`**, mirroring 0030 exactly — revoke the table-level grant
first (a table grant overrides a column grant; getting that order wrong is why
this class keeps recurring), then grant back only what the app writes. For
`resumes` that is `title, source, structured_content, updated_at`, verified
against all three UPDATE call sites rather than assumed. `template_id` is set
only on INSERT, which already gates on an existing unlock. `farah_messages` and
`referral_shares` are never updated by app code at all, so their UPDATE is
revoked outright, as 0031 did for the derived tables.

Post-fix, the same probe returns `42501 permission denied` for both, and the
legitimate save path still works. `tests/rls/column-privileges.test.ts` covers
all of it, including a positive control — a fix that also broke
`saveResumeAction` would have been worse than the bug.

**Swept and deliberately left alone:** `job_postings` (its `WITH CHECK` already
pins `source_type='internal' AND is_org_member(...)`, so 0027's verification
gate cannot be ducked), `applications` (`stage` is governed by 0037's trigger;
the rest is the user's own record), `scholarship_saves` (no gated column).

## schema.org/JobPosting ingestion — one pilot source, per source-eligibility diligence

The second half of M2/§6.12, per `schema-org-job-ingestion-prompt.md`. Four
candidates were checked directly (`robots.txt` plus a real live page, the same
diligence Moniepoint's Greenhouse board got), not assumed from documentation:

| Source | Verdict | Why |
|---|---|---|
| `hotnigerianjobs.com` | disqualified | `robots.txt` names ClaudeBot/GPTBot/CCBot explicitly, `ai-train=no, use=reference` |
| `jobberman.com` | disqualified | `robots.txt` disallows `/job/`, the individual-posting path |
| `myjobmag.com` | disqualified | not blocked by `robots.txt`, but a real listing page has no `JobPosting` JSON-LD at all |
| `fuzu.com` | **disqualified, on a check the brief didn't name** | Passed both the `robots.txt` check (no AI-crawler block) *and* the JSON-LD check (real `title`/`hiringOrganization`/`datePosted` verified live on `/nigeria/jobs/<slug>`) — but its Terms of Service explicitly prohibit "automated tools to scrape... platform data" and "redistributing, or aggregating [Candidate or Employer data] without authorisation." `robots.txt` governs crawler *access*; it is not a redistribution license, and Fuzu's ToS withholds that license in as many words. Don't reopen without a real authorisation conversation with Fuzu — see `sources.config.ts` for the full evidence trail. |
| `jobs.workable.com` (search-by-country) | **qualifies, shipped** | `robots.txt` carries `Content-Signal: search=yes, ai-input=yes, ai-train=no` — explicit AI-input permission, only model-training withheld, a materially better signal than either a named-bot block or Fuzu's silence-plus-ToS-ban. No path disallow on `/search/*` or `/view/*`. Its Terms of Service (checked directly) have no scraping/redistribution prohibition anywhere in them. Verified live on two real Nigeria-market postings. |

Shipped: `src/lib/jobs/sources/schema-org.ts` (two-step crawl — a listing
page's `ItemList` JSON-LD to individual job URLs, each job's own `JobPosting`
block mapped to `NormalizedJobPosting`), wired into `ingest.ts`'s existing
dispatch/dedup/freshness pipeline, one config entry in `sources.config.ts`
(`jobs.workable.com/search/nigeria`). `JobSourceConfig` and
`NormalizedJobPosting.externalSource` are now a three-way discriminated union
(`greenhouse | lever | schema-org`) — see `types.ts`.

**Built in from the start, not retrofitted:** a shape-validation guard
(`validateJobPosting` in `schema-org.ts`) that skips and logs a malformed
`JobPosting` block instead of throwing — the exact contract-drift gap
`greenhouse.ts`/`lever.ts` still have — they cast their API responses through
with no shape check. (A review brief named that gap; the brief is not in this
repo, so the durable reference is those two files themselves.) This fetcher is greenfield, so there
was no reason to repeat it. `IngestSourceResult.skipped` surfaces the count.

**The freshness/closure sweep changed shape for this.** Greenhouse/Lever are
single-company boards, so scoping stale-closure by `(external_source,
company_name)` from the static config was always right and is unchanged. A
schema.org source has no such single company — Workable's aggregated search
spans many hiring organisations in one fetch — so its closure scope is the
whole source, checked against every fingerprint seen anywhere in that fetch.
Verified directly against the live database (`tests/jobs/ingest-schema-org.test.ts`,
plus a manual rolled-back transaction against the live project during
development): a company's posting that drops off the listing closes; a
still-listed company's does not.

**The closure scope is per-source, not per-mechanism.** A schema.org source
writes `external_source` as `schema-org:<label>` (e.g.
`schema-org:workable-nigeria`), and its freshness sweep scopes to that same
qualified value — one function, `schemaOrgSourceKey` in `types.ts`, produces
both so they cannot drift.

The bare `'schema-org'` this replaced was shared by every schema.org row in the
table, and greenhouse/lever's second predicate (`company_name`) has no
equivalent for a multi-employer source. So **any** schema.org ingest closed
**every** schema.org row it hadn't just seen — not only a hypothetical second
source. That was caught the hard way: running
`tests/jobs/ingest-schema-org-multi-source.test.ts` against the unfixed code
closed all 20 real Workable postings in the live project, because the test's
mocked sources have no real postings of their own and everything else looked
stale to them. There is no staging database, which is exactly why that
mattered. Migrations `0039` (re-label) and `0040` (reopen the 20, all verified
still live on the listing) repaired it.

**What "shipped" does not mean here.** This is one well-vetted pilot source,
not a green light to add every schema.org-emitting board found the same way,
and not "relying on this mechanism as a primary supply source" — §10 item 10's
legal review is still the gate for that, unchanged by this pilot. Read
`sources.config.ts`'s comment before adding a second schema-org source.

**Test suite note:** `tests/jobs/schema-org.test.ts` (network-mocked, no DB —
7 tests, all passing, including the real captured fixture in
`tests/jobs/fixtures/workable-job-posting.json`) ran clean in the environment
this was built in. `tests/jobs/ingest-schema-org.test.ts` (the live-database
half — upsert shape and the closure-sweep behaviour above) could **not** be
executed in that same environment: `SUPABASE_SERVICE_ROLE_KEY` isn't available
there, the same pre-existing gap that also blocks all 12 other DB-backed test
files in this repo from running outside CI (confirmed — every one fails with
the identical "not set" error, not something this change introduced). The
closure-query semantics were checked by hand against the live project in a
rolled-back SQL transaction instead (see commit), but the new test itself
still needs a real CI run — the same "typecheck, lint, unit tests" gate every
other PR in this repo goes through — before this is treated as fully verified
by this project's own four-point standard.
