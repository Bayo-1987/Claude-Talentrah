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
| **M2** Job supply & aggregation | **partial** | Greenhouse + Lever live, with dedup and freshness sweep. **schema.org/JSON-LD crawler never built** |
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
- **schema.org crawler** (M2) — blocked on legal review of source reuse terms (§10 item 10).
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
