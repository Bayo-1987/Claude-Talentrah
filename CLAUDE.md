# Talentrah — Project Context

This file is a persistent summary for AI coding sessions on this project. Full detail lives in two source docs — **read them, don't just this summary, before doing real spec or design work**:
- [talentrah-build-prompt.md](talentrah-build-prompt.md) — product spec, strategy, data model, phasing, monetization, all `[DECIDE]` open items.
- [talentrah-editorial-design-handoff.md](talentrah-editorial-design-handoff.md) — visual/design system, content rules. Filename is a historical artifact (kept rather than churning every inbound link for a rename with no functional benefit) — its content describes the current "Sunbird" system, not Editorial; see its own header.
- [Main-Sunbird.dc.html](Main-Sunbird.dc.html) / [JobFeed-Sunbird.dc.html](JobFeed-Sunbird.dc.html) — real working HTML/CSS reference markup (exact spacing/colors/type). Copy values from these, don't eyeball.
- Design-direction canvas (6 directions, Direction E/Sunbird chosen): https://claude.ai/code/artifact/f939960c-d188-4cb0-8a32-69a16e8b90ff

The approved Phase 1 build plan (milestones, tech stack, data model) lives at `~/.claude/plans/adaptive-giggling-ember.md` — refer back to it during implementation rather than re-deriving scope.

## App scaffold

This repo root is also the Next.js app root (App Router + TypeScript + Tailwind, scaffolded via `create-next-app`). `AGENTS.md` is auto-generated/re-added by `next dev` — it points at `node_modules/next/dist/docs/` for version-specific API/convention docs and should be committed as-is, not deleted from diffs. Don't hand-edit `CLAUDE.md` back to a `@AGENTS.md` stub — that was the scaffolder's default and got overwritten with this file on first setup.

Supabase backend: project **"Talentrah"** already exists in the connected Supabase org (`Bayo-1987's Org`), project id `nytwbbzfpytctjsoczzq`, region `eu-north-1`. Reuse it — don't create a new project. It free-tier-pauses when idle; `restore_project` before running migrations/queries if `get_project` shows `INACTIVE`.

**Apply additive migrations BEFORE merging, destructive ones AFTER the deploy**
(adopted 2026-09-08). Merging first is what put production on code referencing
columns that did not exist, twice in one day. Full reasoning in
[docs/production-migration-apply.md](docs/production-migration-apply.md); the
short rule lives in [supabase/migrations/README.md](supabase/migrations/README.md).

**Migrations 0001–0025 are not in this repo** — they were applied straight to the project through the MCP connector, so the project's own `schema_migrations` table is the only history. From 0026 on, write the SQL into `supabase/migrations/` **first** so a policy change can be reviewed in a diff, then apply it. See [supabase/migrations/README.md](supabase/migrations/README.md).

**GitHub Actions CI no longer touches a shared Supabase project at all (Stage 2, corrected 2026-09-08).** The `checks` and `e2e` jobs in `.github/workflows/ci.yml` each spin up their OWN fresh, ephemeral, per-job local Postgres via Docker (`.github/actions/local-supabase` — pins the Supabase CLI, applies every migration in `supabase/migrations/` from `0000_baseline_schema.sql` forward, exports fresh connection details), torn down with the runner. This replaced the single shared hosted `Talentrah CI` project (`dozaffzgqkbarxtlclsj`) as CI's database specifically because that shared project caused three real incidents — an egress blowout, a catalog-reseed race between overlapping runs, and a cross-branch migration collision (applying a migration to a shared project makes it live for every branch's CI instantly, whether or not that branch's own code has merged) — all documented in `ci.yml`'s own header comment, read that before trusting anything below it. **The old `concurrency` group and `.github/scripts/wait-for-ci-lock.sh` that used to serialize runs against that shared project were deliberately deleted once Stage 2 was proven over real pushes** — not an oversight to restore, because the resource they protected no longer exists as a shared resource. Two separate GitHub Actions runs' `e2e` jobs cannot race each other's test data: they are not even the same database. **Before hypothesizing that two CI runs "raced a shared row" or similar, check `ci.yml`'s own header first** — a 2026-09-08 investigation built exactly that theory (plausible, well-reasoned, timing lined up) on the pre-Stage-2 mental model and it was flatly wrong once checked against the workflow file itself.

`dozaffzgqkbarxtlclsj` ("Talentrah CI") still exists as a real, separate, persistent Supabase project — same org, same region, free tier, $0 — but GitHub Actions itself no longer reads or writes it. What it's actually for now:

- **Local developer test runs.** `.env.local` points `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` at it by default, so `npm run seed`, the RLS suites, and any suite run with `ALLOW_TESTS_AGAINST_HOSTED=yes-i-mean-it` hit this project from a developer's own machine (or an agent session) — never GitHub Actions.
- Reused across every session working from this repo, which reintroduces the SAME class of cross-session contention Stage 2 removed from CI — just at the local-dev layer instead. Expect other concurrent sessions' fixtures, migrations-in-flight, and test data in it; this repo's session history has hit real branch-switching and test-data collisions here.
- **Its reference data was bootstrapped by hand** and the seed only partly reproduces it. Standing up a fresh throwaway project for this is not yet one command — see the `credit_packs`/`passes` note in 0051.
- **Migrations must still be applied to it manually** (same as production) — it has no auto-apply-every-migration mechanism the way the ephemeral per-job CI databases do, so it can genuinely lag behind `supabase/migrations/` if a migration was written but not yet applied here.

Three consequences worth knowing before you touch either that project OR production:
- **A local run hits `dozaffzgqkbarxtlclsj`, not production — but that is a property of this machine's `.env.local`, not of the repo or of GitHub Actions.** This line used to describe a committed-nowhere `.env` that held production's URL *and* a working `service_role` key as a fallback layer under `.env.local`; it was deleted on 2026-08-29 after every one of its eleven variables was confirmed to also exist in `.env.local`, so it contributed nothing except a production admin credential one missing file away from being the effective config. **There is no production credential on disk by default any more**, and restoring one re-creates that hazard — so don't, unless you have a specific reason and remove it again afterwards.
  - Check before assuming either way. `NEXT_PUBLIC_SUPABASE_URL` tells you the target; the `ref` claim inside `SUPABASE_SERVICE_ROLE_KEY` tells you which project the key is actually for, and the two can disagree.
  - `tests/setup.ts` refuses to run the suites against production regardless, and that guard is unchanged — it is the backstop, not the reason you are safe.
  - **For one-off production work — a query, a data fix, provisioning an admin — use the Supabase MCP connector.** It reaches production without a credential ever landing on disk, which is the whole point. `npm run grant-admin` and the other scripts read `.env.local` only, so they target whatever project that file points at (normally `dozaffzgqkbarxtlclsj`, never GitHub Actions' own ephemeral databases) unless you repoint it; the connector is the safer path for real production work.
- **Production (`nytwbbzfpytctjsoczzq`) and `dozaffzgqkbarxtlclsj` both need every migration.** They are intentionally allowed to diverge while a PR is in review (the ephemeral per-job CI databases always have every migration by construction; these two persistent projects don't), so check both before assuming a function exists on either.
- **GitHub Actions' ephemeral per-job databases mean a migration bug can be caught by CI without ever touching `dozaffzgqkbarxtlclsj` or production** — which is the point, but also means a green CI run says nothing about whether that migration has actually been applied to either persistent project yet. Confirm separately before assuming a merged PR's migration is live anywhere real.

**Unit tests run BEFORE `npm run seed` in the `e2e` job's own ephemeral database.** Seed lives in the Playwright job, which is `needs: checks` (a separate job, separate ephemeral database, run first only to fail fast on a broken build before spending the ~10 minutes Playwright takes) — so on a database that has never been seeded the unit tests fail first and skip the seed that would have fixed them. Reference data has to exist before the first green run.

**Before starting a new branch, check whether one already exists for the same gap.** This repo runs more than one Claude Code session at once — long-lived interactive sessions and isolated background-agent worktrees both — and none of them can see another's in-progress branch. In one week this produced four independent collisions on two small bugs, each one a full second implementation plus a conflict-resolution pass to undo: the tracker-notes dead-network crash (#376 vs #377), the SEO landing-page signed-in-CTA fix (#381 vs #382), and its filter-preservation follow-up (#383 vs #384) — plus `with-network-fallback.ts` getting built a second time as its own PR (#379) after the branch that first introduced it (#376) was closed unmerged, because nothing recorded that it had already been tried. The fix costs one command: before creating a branch, run `git ls-remote --heads origin` for a name that suggests the same area, and `gh pr list --state all` for an open, merged, or recently-closed PR touching the same files or describing the same gap. Stale worktrees pile up from the same blind spot — `git worktree list` periodically, and `git worktree remove` (never a bare `rm -rf`, which leaves git's own bookkeeping pointing at a directory that no longer exists) anything whose branch is already merged or closed.

## Current build state

**Phase 2 has started.** Auto-Apply shipped as its first milestone — review-queue
gated, Excellent-only, server-capped, credits beyond a free weekly allowance.
Read [docs/auto-apply.md](docs/auto-apply.md) before touching it; the two things
most likely to be got wrong are that its threshold is re-read live at confirm
time (not from the queue row's snapshot) and that its cap is atomic in Postgres
because a read-then-act cap is not a cap. **Auto-Apply never submits to external
postings** — there is no ATS integration, so external matches are handed off to
the source site and marked `handed_off`, never `applied`.

**The admin dashboard has started, at M1: admin identity and the route guard.**
Read [docs/admin-auth.md](docs/admin-auth.md) before touching `/admin`,
`src/lib/admin/` or 0060. The two things most likely to be got wrong: admin
identity is a **separate `admin_users` table**, not a flag on `profiles` — and
deliberately so, because `profiles` is the table whose grant list exists to
grow — and **the cron routes correctly keep the shared secret**, because a
session cookie cannot authenticate a caller that has no browser. The split that
matters is by caller, not by URL prefix: the human-operated `moderate-*` routes
are the ones whose shared secret is the wrong mechanism, and they move to admin
sessions in M2. Being signed in to the seeker app grants nothing at `/admin`;
the guard never reads the Supabase session.

Phase 1 is feature-complete except for the employer side. Read [docs/phase-1-summary.md](docs/phase-1-summary.md) before assuming any feature's status — it is kept current and lists what shipped, what is deferred, and the open defects with their evidence. Two that shape most decisions:

- **The employer side exists**: org onboarding, Company Profile, free job posting, Jobs Posted (Phase 1), plus **Ad Campaigns** (Phase 2 — ad wallet 0046, campaign state machine 0047/0048, Server Actions and review gate). Billing and analytics are still Phase 2 and are deliberately **absent from the employer nav** rather than stubbed — don't add placeholder pages for them, and don't describe them as shipped. Ad Campaigns is in the nav because it is real, not because the rule changed. Building this surface is what exercised the org RLS policies for the first time and found the third hole in them (0028).
- **Ad campaigns are charged per DAY, not per click, and approval never starts one.** Review is about the ad's content; going live is `resume_ad_campaign`, which debits the wallet. Keeping those separate means there is exactly one path from not-running to running and it always charges — a second path would be a second place to forget the charge. CPC is deferred because it needs deduplicated attributable click events that this project has no pipeline for; billing per day charges for something the system can actually observe.
- **Anything that gates on a counted or compared value must check and act in ONE database statement.** A read-then-write in JS is not a gate: `spendCredits` looked correct for months and let two concurrent spends both succeed at `balance == cost`, because the ledger trigger overwrites `credits_balance` absolutely rather than decrementing it. The pattern to copy is `spend_credits_atomic` (0035) — a conditional `UPDATE … WHERE balance >= amount` — or `auto_apply_claim_submission` (0034) where several conditions must hold together under one lock.
- **`hired` is terminal on `applications` except → `archived`** (0037), enforced by a trigger rather than in the Server Action, because the owner-only `FOR ALL` policy makes any app-layer rule reachable around via a direct PATCH. Deliberately narrow: every other stage correction stays allowed, because the tracker is the user's own record and blocking mis-click fixes would be a worse product than the bug.
- **A Supabase delete that is rejected does NOT throw — it resolves with an `error`.** `await admin.from("x").delete().eq(...)` with no error check reports success whatever happened. This is not theoretical bookkeeping: ten test cleanup sites did exactly that, every one of them was being refused `23503`, and test organisations piled up in production for weeks while every hook reported success. The tell is that the symptom appears somewhere unrelated and much later. Check the `error` on any delete whose failure you would want to know about, or use the shared `deleteTestOrgs` / `deleteTestUsers`, which report.
- **The FKs pointing at `organizations` are NOT uniformly cascading, and the exceptions are the common ones.** `ad_campaigns`, `ad_wallets`, `ad_wallet_ledger` and `organization_members` are `ON DELETE CASCADE`; **`job_postings` and `payment_transactions` are `NO ACTION`**. Since almost anything that creates an org also creates a posting, deleting an org usually fails unless you remove those two first. Do not "fix" this by making them cascade — `NO ACTION` is correct for production, because removing an organisation must not silently vaporise live job postings.
- **The test suites create a lot of auth users and can hit Supabase's auth request rate limit** when run back-to-back. A run that fails with `AuthApiError: Request rate limit reached` is not a real failure — wait a few minutes and re-run.
- **RLS row policies do not restrict columns.** Supabase grants `ALL ON ALL TABLES` to `authenticated`, so a permissive UPDATE policy lets the owner rewrite *every* column on their own row. Any column carrying trust, money or identity needs a Postgres column grant, not a policy — `revoke update on <table> from authenticated`, then `grant update (<safe columns>)`. The order matters: a table-level grant overrides a column-level revoke. This produced four live findings (0026, 0027, 0028, 0030); `tests/rls/column-privileges.test.ts` is the standing check, and adding a value-bearing column to a user-writable table should fail it until you decide deliberately.
- **If an RLS policy calls a function, every role that evaluates that policy needs `EXECUTE` on it — including `anon`.** Postgres evaluates a policy as the calling role, and a policy with no `TO` clause applies to `public`. Revoking a grant to "tidy up" is a denial-of-service on your own public surface: 0027 did exactly that and made `job_postings` error for signed-out visitors until 0032 restored it.
- **An organisation's job postings only reach the public feed once `organizations.verified` is true** (0027), and **no client can write `verified`** (0028) — it is set server-side from the session user's confirmed work-email domain, and nowhere else. Anything that surfaces internal postings must not work around that gate, and anything that grants verification must not do it from user input.
  - **A `SECURITY DEFINER` function does not inherit that gate, and two of them didn't have it.** RLS is how almost every surface enforces 0027, so a DEFINER function silently opts out of it — the policy simply never runs. `promoted_jobs` filtered posting status, campaign state and the seeker's filters, and never asked about `verified`: measured live, one user and one instant, the organic surface returned 0 rows for an unverified org's posting while the paid surface returned 1 (0109). The mirror case is a `security invoker` function, which *does* inherit the policy and therefore inherits every later **widening** of it — that is how `search_job_postings` started listing unlisted postings the moment 0107 landed (0108). **So when you touch that policy, the question is not "which queries did I update" but "which functions read this table, and does each one inherit the policy or replace it".** `verified` is also not one-way: a domain change re-runs verification in both directions, so `match_scores` rows written while an org was verified outlive its verification.
- **Self-referral detection normalises Gmail dots and `+suffix`, and deliberately does NOT strip dots elsewhere** (0036) — at a company domain `j.doe@` and `jdoe@` are usually two different people, and blocking that would deny two colleagues a real reward. Three referral decisions are open and written up in [docs/referrals-open-questions.md](docs/referrals-open-questions.md); each is pinned by a test, so don't change one by accident.
- **This repo is PUBLIC. Never commit a working credential, and never assume deleting one later undoes it** — anything pushed is permanently exposed, so rotation is the only real fix. The demo account's password comes from `DEMO_PASSWORD`; the seeded referral accounts get a random password per run. Both are re-asserted on every seed run, so rotating the source actually retires the old value. A full history sweep is written up in [docs/secrets-audit.md](docs/secrets-audit.md).
- **A renewal failure Paystack never confirmed is now retried, not lapsed** (0043).
  This changes operational behaviour: a Pass whose charge times out stays
  `auto_renew_status = 'active'` with its `next_renewal_date` intact and is
  retried on the **next daily cron run**, up to
  `MAX_INDETERMINATE_RENEWAL_ATTEMPTS` (3) before finally lapsing. Two
  consequences worth knowing: **the daily cron is now load-bearing for recovery**
  — retrying is the only mechanism, there is no dunning queue and no alert, so a
  cron that silently stops firing means these Passes never resolve; and a
  `payment_transactions` row with `status = 'pending'` and a
  `user_passes.pending_renewal_reference` set is a **charge of unknown outcome**,
  not a failure — the next run verifies that reference with Paystack before
  charging again, precisely so a timeout that happened after the card was
  debited never becomes a double charge. A genuine decline still lapses on the
  first attempt, unchanged.
- **Production runs GROQ, not Gemini** (corrected 2026-09-08). `LLM_PROVIDER=groq`
  is set on the deployment; the code still *defaults* to Gemini when that
  variable is absent (`src/lib/llm/index.ts`), so the default and the live
  configuration disagree — check the deployment, not the default. This line
  previously said production ran a free-tier Gemini key at 20 req/day, and the
  earlier "Gemini → Groq automatic failover, blocked on Google billing" framing
  is **moot**: Groq is already the production provider, so there is nothing to
  fail over from. A session working from the old note misdiagnoses live
  incidents, which is part of what happened on 2026-09-08.
  - **Groq's cap is per-minute TOKENS, not requests**: `openai/gpt-oss-120b` on
    the tier in use allows 8,000 TPM, and the **reserved output budget counts
    against it** as well as the prompt. That is a different failure shape from
    a daily request quota — it fails intermittently, only for large enough
    requests, and retrying never helps because the retry is the same size. It
    took Farah chat down; see `src/lib/farah/token-budget.ts` for the budget
    and the guard that now holds it.
  - **A SEPARATE cap — Groq's daily token budget (TPD), not the per-minute one
    above — took Farah chat down again on 2026-09-08**, diagnosed as send-109.
    The `on_demand` tier's 200,000 TPD ceiling is shared account-wide across
    every LLM-calling feature (chat, tailoring, gap analysis, scholarship
    eligibility, bullet rewriting, resume-parse fallback), and real usage
    exhausted it in an 11-minute burst. The real error shape, worth
    recognizing on sight — note "tokens per day" is what distinguishes it from
    the TPM error above:
    ```
    [groq/rate_limit] 429 ... on tokens per day (TPD): Limit 200000, Used 198178, Requested 2003. Please try again in 1m18.192s.
    ```
    Fixed in three parts, in the order they actually shipped: (1) the founder
    raised Groq's own billing tier directly in Groq's console — **the actual
    new daily ceiling is not recorded anywhere in this repo and could not be
    confirmed while writing this**; check Groq's own dashboard rather than
    assuming a number, and update this line once it's known. (2)
    `generateWithFailover` (`src/lib/llm/index.ts`, PR #320) — per-request
    runtime failover from Groq to Gemini, scoped deliberately to
    `LLMProviderError`s with `kind === "rate_limit"` only; an `auth` or
    `unknown` error still propagates unchanged, on purpose, so a genuinely
    broken key fails loudly instead of being silently routed around. (3) PR
    #322 covering the 6th and final real call site
    (`src/lib/resume/llm-fallback.ts`'s low-confidence resume-parse path),
    which #320 had correctly left out of its own scope and a later pass
    closed separately — `getLLMProvider()` itself is now called directly only
    from `llm/index.ts` and `cost-probe.ts` (deliberately, for its
    monkey-patch); every real generation call site goes through the failover
    wrapper.
    **The failover is not a second capacity pool**: Gemini (the failover
    target) is a free-tier key, 20 requests/day, shared across the whole
    project (`README.md`, `.env.example`, `docs/secrets-audit.md`) — unless
    that key has since been upgraded too, the failover buys about 20 extra
    requests a day against a 200,000-token daily budget, not real headroom.
    `src/lib/farah/rate-limit-message.ts` turns Groq's own "please try again
    in Xm Ys" text into rounded-to-the-minute user-facing copy
    (`parseRetryAfterSeconds` + `farahRateLimitMessage`), falling back to the
    pre-existing generic "try again in a moment" message on anything it can't
    parse.

Verification convention this repo holds itself to, visible throughout its PR history: **check real current state before building; prove a fix by first proving the test catches the bug.** Several milestones caught real defects specifically by re-testing what earlier work had assumed — an RLS policy that had never been run, a retry heuristic that looked like model behaviour, an OAuth name mapping where the intuitive fix would have repaired the wrong provider, and an org-membership policy that read as safe and was not. That last one is also the standing example of a second habit: after fixing a policy, ask what *else* grants the same privilege — the first fix closed one route and, in doing so, opened a second.

**A clean check result is not proof that there is nothing there.** An empty
grep, a zero-row query, a diff with no hits, a scripted replacement that
reports success — all of these look identical whether they found nothing or
were incapable of finding anything. This bit three times in one day
(2026-08-29), each with a different underlying cause and each producing output
nobody would have questioned:

| what was run | why it found nothing | how it was caught |
|---|---|---|
| `where window_start > '12:00:00Z'` | `window_start` is hour-truncated, so `>` excluded the 12:00 window — the one that mattered | someone re-ran it and got rows |
| a scripted `s.replace(old, new)` | the anchor text did not exist on that branch, so it replaced nothing and still printed success | `git status` showed the file unmodified |
| `grep "unprotected by a second factor"` | the phrase wrapped across a line | re-checked with newlines flattened |
| `grep … \| head -5` over route callers | the answer was **truncated**, not empty — real callers sat below the cut | ran it again without `head` |

The first reported "no rate-limit rows at all" during an incident and nearly
cost another session a correct diagnosis. The second would have shipped an
admin page unreachable from the nav. The third reported a doc clean that still
carried a false claim.

**A TRUNCATED result is the same failure wearing a different hat**, and it is
worse because it looks like data rather than absence. `head`, `limit`, a
default page size, `--limit 20` — each turns "here is the answer" into "here is
as much as I asked for", and nothing in the output says which you got. The
fourth case above was reported as *"no in-repo caller uses these routes"* and
offered as the evidence for deleting them; three test files were sitting two
lines below the cut. Count first, or drop the limit and read the whole thing —
a pipe into `head` is fine for looking and never fine for concluding.

So: **an empty or truncated result is a claim, and it gets a second method.** Flatten the
newlines. Widen the window and see the count move. Assert the anchor matched
rather than trusting the exit code. Check `git status`, not just the script's
own output. If a search returns nothing where something plausibly exists,
the burden is on the search, not on reality.

This is the same reflex as the "prove the test catches the bug" rule above,
pointed at the tools instead of the code: a test that passes for the wrong
reason and a grep that matches nothing for the wrong reason are the same
mistake wearing different clothes.

---

## What Talentrah is

An AI-powered career platform for job seekers in Nigeria/Africa, with a self-serve employer side. Two-sided:
- **Job seekers**: AI-matched job feed, paste-a-job-link → instant tailored resume + cover letter, application tracking, resume builder, referrals, human mentorship.
- **Employers**: post jobs, company profile, self-serve ad campaigns.

**Farah** is the AI copilot — a named, consistent-voice persona (encouraging, direct, practical) threaded through the whole seeker experience, not a bolted-on chatbot. Never call her "the AI" or "the bot."

**Core differentiation thesis**: Jobright/LinkedIn/Indeed are US-centric and underserve Nigerian/African job seekers — real gap, but a *hypothesis to validate* with real users, not an assumed fact. Talentrah's actual product-level differentiators vs. AI-only competitors:
1. Real human **Mentorship** marketplace (not just AI "coaching") — shipped 2026-09-10 (PR #341, send-137).
2. **Auto-Apply** positioned as a trust/quality feature (review-before-submit default, conservative match threshold) — not a spam-driving volume feature.
3. Lower visual density than incumbents (see Design System below) — calm/editorial, not sales-driven SaaS.
4. Diaspora expansion (UK/US/Canada Nigerians) as a natural Tier-1 hard-currency market — NOT competing head-on for US/UK job seekers generally.

## Strategic prioritization (don't build all bets at once)

**Load-bearing for launch:**
- Localization validation + execution
- Job supply/liquidity via aggregation (§6.12 of build prompt) — product is useless without real jobs
- Core AI tailoring loop (JD import → gap analysis → tailored resume) — the actual "aha moment"

**Explicitly deferred until core loop proves retention:**
- Deep virality/shareable mechanics (job search is often confidential — private-by-default).
- Outcome-data matching moat (too noisy with small early user base).

Mentorship marketplace (§6.11) and Talent Directory & Verification (§6.13) — both listed here as deferred bets in earlier versions of this doc — shipped 2026-09-10 (PR #341/send-137 and PR #342/send-139). **When a feature ships, check every surface a user could reach it from, not just the route existing**: #341 shipped a fully working `/mentorship` with no nav link anywhere a signed-in user or visitor would see it (only `admin-nav.tsx`, its moderation queue, was touched) — caught after the fact, not before. `marketing-footer.tsx`'s own comment already had the right instinct ("add each back when the feature ships, with a real href") but nobody was watching for the trigger.

## Build phasing (see build-prompt §9 for full detail)

- **Phase 1 (MVP)** — currently being built, see the plan doc referenced above: auth/onboarding, resume upload/parse, job aggregation pipeline, match-scored feed, manual apply, Job Tracker, Resume Builder (subset templates), JD paste-text tailoring, Farah chat panel, free org job posting, Refer & Earn (credits-only), Credits + Prepaid Passes with mobile-money-native payment rails (Paystack).
- **Phase 2**: Auto-apply, full template library, Ad Campaign Manager (flat-rate → CPC), employer billing, URL-scraping JD import, "claim your listing" flow, diaspora currency/billing.
- **Phase 3**: Talent Directory & Verification, internships, Mentorship marketplace, CPA billing, referral leaderboard, proactive Farah nudges. Of these, Talent Directory & Verification, Mentorship marketplace, referral leaderboard, and proactive Farah nudges shipped 2026-09-10 (PRs #339–#342); internships and CPA billing remain deferred.
- **Phase 4**: Managed Services commercial launch (recruitment/staffing/outsourcing) — lead-capture only, manual sales. In-house dev-project outsourcing is **explicitly cut from the roadmap entirely** (it's a different business).

## Information architecture

**Job seeker nav** (masthead, not icon sidebar): Jobs · Job Tracker · Resume Builder · Refer a Friend · Mentorship · Feedback · Settings. Persistent: global search, notifications, language selector, "Post Job" shortcut, credits/upgrade CTA, profile menu, docked Farah panel on key screens.

**Employer nav**: Jobs Posted · Company Profile · Ad Campaigns · Billing · Analytics.

## Key feature specs (see build-prompt §6 for full detail on each)

- **6.1 Landing/onboarding**: interactive JD-tailoring demo embedded pre-signup (rate-limited, one free run/session/IP), no invented social proof/stats, no hero video for v1. Footer carries employer links, legal/trust, WhatsApp + Telegram community links. No region/currency selector in v1.
- **6.2 Job feed**: tabs (Recommended/External/Most Recent/Saved), removable filter chips, Auto-Apply toggle (conservative default: capped, review-before-submit, activity log), job cards show Match Score prominently + "Ask Farah" quick action, restrained badge density. Clearly distinguish internal vs. aggregated/external jobs.
- **6.3 JD import → tailoring**: paste URL or text → parse → Farah gap analysis → tailored resume + cover letter → ATS score + specific fixes → export PDF/DOCX. First tailoring run + first cover letter are one-time free trial; everything after draws from Credits.
- **6.4 Resume Builder**: template gallery by industry → editor (drag-reorder, AI bullet rewriting) → preview/finalize. Free tier = limited templates; more via credits/pass.
- **6.5 Farah**: docked panel (job feed, resume builder) with quick actions (CV Builder, Interview Prep, Career Advisor, Cover Letter, Salary Negotiation) + free-text chat. Farah's coaching stays informational/scalable (benchmarking, talking points, practice Q&A) — routes to human Mentorship for high-stakes/judgment situations (real offer, real interview, real negotiation). Farah is the on-ramp to Mentorship, not a competitor to it.
- **6.6 Job Tracker**: Saved → Applied → Interviewing → Offer → Rejected/Archived. Manual entries allowed. Marking "Hired" triggers the post-success lifecycle flywheel (referrer/mentor invite prompts).
- **6.7 Refer & Earn**: unique link, WhatsApp-priority sharing, funnel tracking (invited→signed up→activated→reward), anti-abuse (self-referral detection, activation-gated payout). Prefer credit rewards over cash (avoids KYC/payout infra).
- **6.8 Employer ads**: sponsored listings (build first) → banner/display → featured employer profile. Pricing model: flat-rate first, then CPC, CPA deferred (needs reliable attribution). Employer billing via Paystack/Flutterwave.
- **6.9 Monetization**: free/uncapped for zero-AI-cost actions (browsing, tracker, algorithmic scoring). One-time free AI trial at signup, not renewable. **Talentrah Credits** for all AI actions beyond that (tailoring, cover letters, bullet rewriting, premium templates, auto-apply beyond free cap). **Passes** (7-day/30-day): auto-renew if paid by card (Paystack/Flutterwave token or Stripe for diaspora), stay prepaid/non-renewing if paid via mobile money wallet. Mentor sessions are NOT a credits action — paid directly, real cash pass-through. Multi-rail payments (mobile money + card) required from day one, not retrofitted. Pricing anchors: credit ≈ ₦150; packs ₦2,500/₦6,000/₦12,500; passes ₦2,000 (7-day) / ₦6,500 (30-day); diaspora subscription $9.99/mo — all researched anchors, **not validated**, need a real pricing test before locking in.
- **6.10 Notifications**: transactional (immediate: status change, referral conversion, ad milestone, pass renewal reminder) vs. digest (batched: new match digest). Voice by sender: Farah-voiced for relationship-y notifications (matches, referrals), neutral system voice for factual/B2B ones. Voice by channel: in-app terse, email structured, WhatsApp conversational. Template-variable based copy, not hardcoded.
- **6.11 Mentorship** *(shipped 2026-09-10, PR #341/send-137)*: real human mentors, clear line vs. Farah's shortcuts (mentors = high-stakes/judgment: mock interviews, negotiation for a specific offer). Profiles, discovery, booking, session lifecycle, vetting/approval queue. Payments direct (not credits); free/volunteer mentors are a permanent option, not just bootstrap. Session pricing ₦5k–₦100k+ by tier; **platform commission 15% flat**.
- **6.12 Job supply/liquidity**: aggregate via ATS APIs (Greenhouse, Lever, Workday, etc.) + schema.org JobPosting data + regional board partnerships (Jobberman, MyJobMag, Fuzu). Avoid scraping ToS-prohibited platforms (LinkedIn, Indeed). "Claim your listing" employer conversion flow. Dedup/freshness pipeline. UI must clearly distinguish aggregated vs. direct jobs. **Jobberman, MyJobMag and Fuzu are partnership targets specifically — a negotiated, authorised relationship, not direct schema.org ingestion.** All three were checked and disqualified for the direct-ingestion mechanism (Jobberman/robots.txt disallow, MyJobMag/no JSON-LD, Fuzu/JSON-LD present but its ToS explicitly bans automated scraping and redistribution without authorisation — see `docs/phase-1-summary.md`'s *schema.org ingestion* section for the evidence). A real partnership conversation with any of the three is unaffected by that; don't read the disqualification as ruling them out generally.
- **6.13 Talent Directory & Verification** *(shipped 2026-09-10, PR #342/send-139)*: searchable verified talent pool sold to 3 buyers — global/diaspora employers (primary FOREX surface), local employers (trust/anti-fraud), job seekers themselves (competitive edge, paid via credits). Skills verification (AI-graded + paid human review tier), portfolio surfacing, remote-readiness metadata.
- **6.14 Managed Services** *(deferred, own "Business Services" page, not seeker-facing)*: tech recruitment + client-managed outsourcing (first wave, once directory has supply), general HR staffing, internships (cheap, do early — good directory cold-start lever). Partner (don't build) EOR/payroll via Deel/Remote/local PEO. **In-house dev outsourcing is cut entirely — treat as out of scope, not just deferred.**

## Data model (see build-prompt §7 for full field-level detail)

Core entities: User, Resume, JobPosting, Application, MatchScore, Organization, AdCampaign, AdEvent, Referral, CreditLedger, PaymentTransaction (tracks rail + auto-renewal state separately from product), Mentor*, MentorshipSession*, VerificationCredential†, PortfolioItem†, TalentDirectoryAccess†.
(* = Phase 2+, † = Phase 3+)

The Phase 1 subset of this schema (actual table list being migrated into Supabase) is spelled out in the plan doc referenced above.

## Non-functional requirements (build-prompt §8)

- Encrypt PII (resumes/JDs) at rest, ownership-restricted access, support account/data deletion.
- Cache parsed JDs, avoid redundant LLM calls, loading states for anything >~2s.
- Auto-apply: never silent-submit without opt-in; auditable log of what/where/when.
- Ad billing: dedupe/attribute impression/click/apply events reliably before billing touches them.
- Multi-rail payments (mobile money + card) from day one.
- Aggregation pipeline runs as background jobs, not blocking request path.
- **Device/bandwidth accessibility is a real constraint**: target market skews low-end Android + expensive mobile data. Keep payloads light, treat visual density as a performance/cost issue, not just aesthetic.

---

## Design system ("Sunbird")

Replaced "Editorial" (newspaper/magazine metaphor, no border-radius, no shadows) wholesale in one PR (send-197) — full swap, not phased. Full detail, including the match-tier bug found and fixed during the swap and the known gaps it left open, lives in [talentrah-editorial-design-handoff.md](talentrah-editorial-design-handoff.md) (filename is a historical artifact; its content is current). Summary below.

The opposite of Editorial's hard rules, deliberately: **fully rounded cards** (14–20px radius) **and pill buttons/badges**, **a soft drop shadow on every card** (`0 4px 16px oklch(30% 0.05 35 / 0.08)`), geometric shape accents (circles, a triangle) as decoration.

### Colors (oklch CSS custom properties — see globals.css or either .dc.html file for the exact block)

```css
--bg: oklch(98% 0.015 55);          /* page background */
--card: oklch(100% 0.005 55);       /* card/box background */
--ink: oklch(22% 0.02 30);          /* primary text, dark buttons */
--ink-soft: oklch(42% 0.02 30);     /* secondary/body text */
--ink-faint: oklch(58% 0.015 40);   /* tertiary text, timestamps */
--coral: oklch(63% 0.19 35);        /* primary accent — CTAs, links, active states */
--coral-hover: oklch(55% 0.19 35);
--teal: oklch(55% 0.11 195);        /* secondary accent — Farah panel, info, "Good" match tier */
--teal-soft: oklch(92% 0.03 195);
--gold: oklch(78% 0.14 85);         /* decorative accent — shapes/highlights only */
--green: oklch(55% 0.13 150);       /* "Excellent" match tier */
--amber: oklch(45% 0.1 70);         /* "Fair" match tier */
--line: oklch(89% 0.015 55);        /* hairline dividers, thin borders */
```

Plus three tokens the Sunbird artboards don't define (no equivalent need existed in the mockups), carried forward from Editorial's roles and recomputed at Sunbird's hues: `--bg-alt` (alternating section background), `--coral-soft` (tinted backgrounds), `--ink-line` (footer dividers on dark `--ink`).

**Match-tier system — exactly three tiers, used everywhere a score appears, never a 4th tier or bespoke wording:**
- Excellent (~80%+) → `--green` / `--green-soft`
- Good (~70–79%) → `--teal` / `--teal-soft` — **deliberately not `--coral`**, unlike Editorial's equivalent (Good → `--rust` there): `--coral` is this system's own CTA/action color, rendered directly beside match badges on the same card (a job card's "Apply" button), so a coral Good badge would blur "clickable" with "score" exactly where it matters most.
- Fair (~60–69%) → `--amber` / `--amber-soft` — a real defined pair; the Sunbird artboards themselves used an undefined one-off inline color here, fixed rather than replicated (see the handoff doc's own note).

### Typography

- Headings (h1–h3): **DM Serif Display**, weight 400 (its only cut — no 500/600 to step up to). `DM+Serif+Display` (normal + italic).
- Body/UI: **DM Sans**, weights 400–700.
- Eyebrow labels: DM Sans, 11–12px, weight 700, `letter-spacing: 0.08em`, uppercase, `--coral`. Must literally describe the section/element directly below it — no decorative/invented mythology.
- Italic DM Serif Display = quiet/secondary asides (placeholders, captions, taglines).
- The four resume-builder skeleton fonts (`--font-geometric`/`--font-humanist`/`--font-serif-modern`/`--font-condensed` — Poppins/Work Sans/Lora/Barlow Condensed) are untouched by this swap: template choices for user-facing resumes, unrelated to the app's own chrome.

### Components

- **Buttons**, all `border-radius: 999px` (pill), min-height 44px: Primary (`--coral` bg, white text → hovers `--coral-hover`), Secondary (transparent, 1px `--line` border → hovers coral), Ghost (no border, hovers coral text).
- **`Card`** (renamed from Editorial's `BorderedCard` — that name described a border-and-no-radius convention that no longer applies): rounded corners, `--card` background, a soft shadow **by default** (opposite of Editorial, which reserved a shadow for exactly one element).
- **Classifieds-row list** (landing page job preview only): border-bottom `--line`, no card chrome, large serif match % on left — unchanged from Editorial.
- **Dashboard job cards** (JobFeed): rounded `Card` with the shared shadow, circular 40–56px `--ink`-bg two-letter company badge (never a brand color — would look like a 4th match tier), circular 40×40px icon buttons for Save/Share, `.btn-text` for "Ask Farah", `.btn-primary` (pill) for "Apply".
- **Masthead doubles as app nav** — no icon sidebar, ever. Same component signed-out and signed-in, just marketing links swapped for Jobs/Job Tracker/Resume Builder/Mentorship/Refer a Friend.
- **Farah panel**: the artboards draw this as a full elevated card (rounded, shadowed) — a real departure from Editorial's flat marginalia rule. **Not yet adopted in `src/components/app-shell/farah-panel.tsx`** — flagged in that file's own header comment as a deliberate, deferred scope decision (its sticky/scroll shell and dependent e2e specs need care), not silently left inconsistent.
- **Every interactive element** must have a real ≥40×40px hit target, even small ones (was a real shipped bug — icon glyph sized ≠ clickable area sized).
- No emoji as icons — inline SVG only. No stock photography / fake human avatars for Farah — she's the abstract two-overlapping-circles mark only. No profile-completion bar / gamification meter anywhere (hard rule, ties to build-prompt §2.5's anti-gamification retention stance).
- **Known gap:** ~59 files still hardcode an ad-hoc bordered box instead of using `Card` — correct tokens, just not yet the rounded/shadow treatment. Listed in the handoff doc's §9; a dedicated sweep is the natural next PR, not something this swap silently left unrecorded.

### Layout

- Max content width 1120px, `padding: 0 40px`.
- Section rhythm: 88–96px vertical padding, alternating bg/bg-alt with hairline border between (always pair divider + bg change, never just one).
- Grids use explicit `gap`, never margin-spaced siblings.

### Content/copy rules

- Never put unmeasured specific time estimates on AI output ("10 seconds") — broken promises cost more trust than vague ones.
- Scope every "free"/"no account" claim precisely at the point the claim is made (match score + preview = no account; export/save/apply/interview-prep = account + possibly credits).
- One term per concept everywhere: "create a free account" (never "sign up"/"sign in" in body copy); "Resume" not "CV"; don't invent jargon like "JD Tailoring" as a public label.
- Match-tier wording must agree across every screen (Excellent/Good/Fair — no "a good match" prose bypassing the system).
- Don't repeat the same sentence verbatim in two sections — vary phrasing or cross-reference.

---

## Open decisions still needing founder input

See build-prompt §10 for the full numbered list (20 items). Highlights not to silently assume:
- Real user validation of the Nigeria/Africa localization bet before heavy investment.
- Replace the reference design's real-public-figure testimonial with a fictional persona (legal/IP risk as-is).
- Exact referral reward trigger/value, ad pricing model choice, mobile-money provider/country scope for v1, whether a true subscription exists and for which segment.
- All pricing (credits, passes, ads, mentor sessions, Talent Directory fees) is researched-anchor only, not tested — needs a real pricing experiment before launch lock-in.
- Legal review needed: schema.org data redistribution, multi-jurisdiction (tax/KYC/GDPR) compliance before diaspora billing.
- ~~Still open: scholarship source legal review (§10 item 19)~~ — **resolved 2026-09-01**, see below.

**Resolved, don't re-litigate:**
- **§10 item 19, scholarship source data policy** — resolved 2026-09-01: the founder
  approved the data policy in [docs/scholarship-sources.md](docs/scholarship-sources.md)
  as drafted (facts only, official permitted sources only, always attributed and
  linked, provider takedown honoured, daily re-check withdrawing closed listings).
  That policy — and the per-source robots/terms evidence recorded alongside it —
  is now the standing rule for scholarship sourcing; a formal external legal review
  remains recommended before diaspora billing, alongside the other multi-jurisdiction
  items, but no longer blocks scholarship sourcing or the public catalog surface.
- **§10 item 20, scholarship geographic scope** — settled: listing scope is *eligibility-relevant, not geography-restricted*. A programme belongs in the catalog if it's realistically open to and relevant for Nigerian/African applicants, wherever it's hosted (DAAD/MEXT/Erasmus/Commonwealth all qualify). Per-applicant filtering lives in the eligibility-check Farah action; the catalog is **not** an enforcement layer and no geographic filter exists in ingestion or browse — deliberately. Chosen as the cheapest-to-reverse default; revisit on real user signal rather than on a schedule.
- **Employer-applicant view consent (0125/PR #329, 0126)** — resolved 2026-09-09: applying to a job posting is treated as implicit consent for that posting's organisation to see the applicant's name, resume content, and application timing via the employer-applicant view. No opt-in/opt-out exists or is planned. As a partial counterweight, the seeker's Job Tracker shows when an employer has actually opened their resume (`employer_applicant_status.first_viewed_at`, set once, via `record_employer_resume_view`/`seeker_application_view_status`, 0126) — informational only, and it never gates or delays the employer's own access. This was flagged explicitly during the 0125 build rather than assumed away; the founder's call folds implicit consent and the view notice into one decision, not two. If a future feature needs finer-grained control (e.g. withdrawing one specific application's visibility, or a real opt-out), treat that as new scope, not as a gap in 0125/0126.

## Deliverable expectations for a build

Per build-prompt §11: working full-stack app (or live Lovable-style preview) covering at least Phase 1 MVP, README with setup/env/architecture-decision notes, seed/demo data (mixed internal + external jobs, a fake org, a demo user), and an end-of-build summary of what was built vs. deferred and which `[DECIDE]` items were assumed vs. still open.
