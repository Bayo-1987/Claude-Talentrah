# Talentrah Phase 1 — end-of-build summary

Required by build-prompt §11 and the plan doc's M10. First written 2026-08-24;
**re-verified against `main` on 2026-08-24 after PRs #17–#22**, which is when
several of the "known defects" below stopped being true.

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
| **M8** Employer side | **not started** | Tables exist; **zero product surface**. Their RLS policies had never been exercised, which is where the org-membership escalation was found and fixed (0026) |
| **M9** Refer & Earn | done | Two-step reward, share surfaces, anti-abuse |
| **M10** Cross-cutting polish | done | RLS verification, service-role audit, README, golden-path e2e all landed. Mobile/low-bandwidth payload check still not done |
| *(added later)* Scholarship Discovery | done | Not in the plan doc; added to build-prompt §6.15 mid-build |

## Numbering drift

The repo's PR labels stopped matching the plan doc partway through: "M8" shipped Refer & Earn (plan M9), "M9" shipped Resume Builder (plan M4), and "M10" shipped Scholarship Discovery — colliding with the plan's M10, *Cross-cutting polish & delivery*.

That collision is why two whole milestones went unnoticed as unbuilt: something called "M10" shipped, so the list looked finished. Worth fixing the labels or the plan doc before Phase 2 repeats it.

## Deferred, deliberately

- **M8, employer side.** The whole self-serve employer product. Legal/marketing copy has been corrected so it no longer claims otherwise.
- **schema.org crawler** (M2) — blocked on legal review of source reuse terms (§10 item 10).
- **Auto-apply, ad campaigns, URL-based JD import, mentorship, talent directory** — Phase 2/3 by design.

## Assumptions made where the founder hasn't decided

Each stands in for an open `[DECIDE]` item and should be revisited, not inherited:

| Assumption | Open item |
|---|---|
| Email verification gates Apply/Tailor, not browsing | §6.1 |
| Referral rewards: +20 signup / +50 activation / +20 welcome | #4 |
| Employer verification = work-email domain only | — |
| 7 resume template categories | plan M4 |
| Paystack as the only rail | #7 |
| All pricing is a researched anchor, never tested | #18 |

**Resolved during the build:** §10 item 20 (scholarship geographic scope) — listing scope is eligibility-relevant, not geography-restricted.

## Known defects, not fixed

1. **`GEMINI_API_KEY` is a free-tier key** — 20 requests/day, and production is intended to run Gemini. A billed key is required before launch or AI features hard-fail almost immediately. Founder/account action, not a code change.
2. **`CRON_SECRET` presence in Vercel Production is unconfirmed**, and **no scheduled cron has ever fired**. Production runtime logs over the last 7 days contain three requests (`/` ×2, `/signup`), and no cron invocation at all — expected, since the crons were added mid-day and both run in the early-morning UTC window. First real opportunity is 06:00 UTC (`renew-passes`) / 07:00 UTC (`ingest-scholarships`) the following day. Confirm by looking for `[scholarship-ingest] cron run: ok=true` — a 401 or silence means it is still not working.
3. **The database schema is not in version control.** Migrations 0001–0025 were applied straight to the Supabase project through the MCP connector; the project's own `schema_migrations` table is the only history. A policy change therefore cannot be reviewed in a diff, and a fresh project cannot be rebuilt from this repo. `supabase/migrations/` starts fixing this going forward; backfilling the first 25 is a separate job.
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
- **Organisation-membership RLS, two defects, both live until 2026-08-24** (`0026`). Any authenticated user could `INSERT` themselves into **any** organisation with a caller-chosen role of `owner` — the policy checked only `user_id = auth.uid()` and never asked whether the caller had any relationship to the org (verified against the live project: HTTP 201, real row). Separately, the `organization_members` SELECT policy referenced its own table, so it — and every policy resolving membership through it (`organizations` UPDATE, `job_postings` INSERT/UPDATE) — failed with "infinite recursion detected in policy". The second masked the first: the escalation could not go anywhere because the downstream rules crashed before they could allow anything, so fixing the recursion alone would have switched it on. Both fixed together in one migration, with `tests/rls/org-and-referral-scoping.test.ts` proven to fail twice against the unfixed database and a positive control proving the legitimate path (create org → join → read → edit → post) still works.

## Verification actually performed

Re-run together on `main` on 2026-08-24, not just per-PR in isolation:

- **Typecheck + lint** — clean.
- **Vitest — 63 tests on `main`, 75 on the 0026 branch, 84 once PR #22 also merges** — all passing. Includes the RLS cross-user gate (`tests/rls/cross-user.test.ts`: two real authenticated users, 13 owned tables, reads *and* writes, proven to fail when RLS is weakened), the new org-membership/referral suite, the `fulfillPayment` scoping regression, resume sanitisation, and the tailoring retry heuristic.
- **Playwright, 8 e2e specs** — all passing, including the golden path (browse → apply → track → tailor → spend credits → refer) against the real routes with only the model stubbed.
- **Service-role scoping** — all 17 `createServiceRoleClient()` call sites re-inventoried on current `main`. No new call site since the #18 audit; one site *removed* (a dead `sendDeadlineReminderEmail` that took a `userId` and was pre-shaped for the same bug). Every `userId` reaching a service-role query is still derived from `auth.getUser()` or `getAuthedUserId()`.
- **Table coverage** — all 22 public tables have RLS enabled. 14 carry a `user_id`; 13 are in the cross-user suite's `OWNED_TABLES`. The fourteenth is `organization_members`, and `referrals` is user-scoped through `referrer_id`/`referred_user_id` with no `user_id` column — the two gaps that hid the org escalation. Both are now covered by `tests/rls/org-and-referral-scoping.test.ts`, so every user-scoped table has a standing test.
- Live end-to-end payment verification: real Paystack test-mode purchases on card and bank rails, plus a real scheduled pass renewal.
- Real measured LLM unit economics (`npm run estimate-costs`) — every credit action clears ~98–99% margin.
- Moderation gate verified at the database layer, and again through an authenticated client in the RLS suite.

**Not performed:** a mobile/low-bandwidth payload check (plan-doc M10, still outstanding), and confirmation of a real cron firing (defect #2).

## Standing caveats

- **The LinkedIn half of the OAuth name fix is unverified against a real account.** It was built from LinkedIn's published OIDC userinfo schema and a test fixture, because no LinkedIn account exists in this project. Google's half came from this project's own real `auth.users` metadata. Check the LinkedIn path the first time a genuine LinkedIn signup happens — the two providers really do send different shapes, so a Google-only confirmation proves nothing about it.
- **Tests run against the live Supabase project.** There is no separate test project. The suites create namespaced throwaway users and clean up after themselves, but a dedicated project or Supabase branch is worth setting up before this repo has more contributors.
