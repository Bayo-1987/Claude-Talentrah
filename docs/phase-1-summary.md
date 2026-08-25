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
| **M4** Resume Builder | done | 7 templates, drag-reorder, credit-gated AI bullet rewriting, print-to-PDF |
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

## Premium-template paywall was bypassable in production (0041)

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
`test-scenarios-external-api-integrations-prompt.md` §1 already names as
missing from `greenhouse.ts`/`lever.ts`. This fetcher is greenfield, so there
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
