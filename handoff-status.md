# Talentrah — Handoff Status

Single-file record of what has shipped and how it was verified. Kept current
after every merge, so state is reconstructable from this file alone.

> **This file was created on 2026-08-25 16:00 UTC.** The priority backlog that
> asked for it to be "updated the same way it's been maintained so far"
> referred to a file that did not exist in this repo or anywhere under
> `~/Desktop`, `~/Documents` or `~/Downloads`. Neither did any of the other
> documents that backlog cites — see [Missing input documents](#missing-input-documents).
> Everything below is therefore reconstructed from the git history, the live
> Supabase project and live production probes, not copied forward from a
> previous version.

---

## Verification standard

This project has been burned by reported-but-untrue merge claims. The standard
now is: **a merge is not confirmed until it has been checked by a method a
second party could reproduce, against live state.** For every merge recorded
below that means all four of:

1. `GET /repos/:owner/:repo/pulls/:n` reporting `merged: true` with a
   `merged_at` and `merge_commit_sha`.
2. A **fresh shallow clone** of `main` — not the local working copy, which can
   be stale or dirty — with the expected files asserted present.
3. Where the change is observable from outside, a **live production probe**.
4. The full test suite run against merged `main`.

Un-pinned `raw.githubusercontent.com` fetches and cached GitHub web pages have
both served stale content in this project's history. Don't rely on either.

---

## Merged 2026-08-25 — PR #40, resumes/Farah column privileges (0041)

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#40](https://github.com/Bayo-1987/Claude-Talentrah/pull/40) | `fix/resumes-column-privileges` | 18:05:42 | `a0925ab` |

3 files, +373/−0. **Two live, exploitable gaps in production — not design nits.**
Both were confirmed with a real authenticated session against the production
project *before* being fixed, and both are stated plainly here because
"review found some improvements" would misrepresent what was actually open.

### 1. Any user could unlock every premium template for free — the reported issue

`resumes` carries a correct owner-only policy —
`for all using (auth.uid() = user_id) with check (auth.uid() = user_id)` — and,
unlike `profiles`/`organizations`, had **never** had a column grant applied.
Supabase grants `UPDATE ON ALL TABLES` to `authenticated`, so the owner owned
every column on their own row. `template_id` points at `resume_templates`, whose
`is_premium` rows cost credits through `unlockTemplateAction` (checks
`user_template_unlocks`, then calls `spendCredits`). A client writing the column
reaches none of that:

```
premium template: Portfolio Grid (costs 10 credits)
unlocks owned: 0   credits: 0
update error: none
template_id now: 7704054a-6c90-40b6-a977-ef6e2e1c404f
=> BYPASSED — premium template applied, 0 credits spent
credits after: 0 (unchanged = never paid)
```

A user with no credits and no unlocks applied a paid template. Anyone who opened
the network tab had the entire premium library, and had done for as long as the
feature has shipped.

### 2. The sweep's own find — the Farah LLM spend cap was self-resettable

Found by the "what else grants the same privilege" pass CLAUDE.md makes standard
after a policy fix. `resumes` was what was reported; this was sitting next to it
and nobody had asked about it.

`/api/farah/chat` caps a user at 30 messages an hour purely as a cost safety net
on unbounded authenticated LLM spend, and counts its own rows —
`.eq("role","user").gte("created_at", oneHourAgo)`. Both columns sat inside the
same unrestricted owner-only grant, so **the counter was writable by the thing
being counted**:

```
counted toward the 30/hr cap: 1
backdate error: none
counted after backdating: 0
=> BYPASSED — quota reset, unlimited paid LLM calls
```

Of the two, this is arguably the larger exposure: the template bypass costs
Talentrah a template unlock, this one costs uncapped model spend on a free-tier
key.

### The sweep, in full

Six tables had the exploitable shape (owner/member UPDATE policy + table-wide
grant). What each turned out to be:

| Table | Verdict |
|---|---|
| `resumes` | **fixed** — `template_id` paywall bypass, plus `is_base`/`user_id` locked |
| `farah_messages` | **fixed** — UPDATE revoked outright; nothing in `src/` ever updates it |
| `referral_shares` | **revoked** — hardening, labelled as such; no exploit found, but nothing updates it either |
| `job_postings` | left alone — its `WITH CHECK` already pins `source_type='internal' AND is_org_member(...)`, so 0027's verification gate cannot be ducked and a posting cannot move orgs. The policy carries the column constraint itself. |
| `applications` | left alone — `stage` is governed by 0037's trigger; the rest is the user's own record, and CLAUDE.md is explicit that blocking mis-click corrections is a worse product than the bug |
| `scholarship_saves` | left alone — no gated column |

### The fix

Mirrors `0030` exactly, including the ordering that makes this class recur:
**revoke the table grant first**, because a table-level grant overrides a
column-level one — granting columns without revoking first changes nothing.

The grant list was re-verified against the code rather than accepted: all three
UPDATE call sites (`saveResumeAction` at `actions.ts:137`; `upsertBaseResume`'s
two paths at `:47`/`:80`) write only `title`, `source`, `structured_content`,
`updated_at`. `template_id` is legitimately set only on **INSERT**
(`actions.ts:113`), which the migration does not touch and which already gates on
an existing unlock. `scripts/seed.ts:279` does update `template_id`, but runs as
`service_role`, which column grants do not constrain. `deleteResumeAction`
(`actions.ts:203`) uses DELETE, also untouched.

### Verified, four-point standard

1. **PR API** — `merged: true`, `merged_at 2026-08-25T18:05:42Z`,
   `merge_commit_sha a0925ab7b0938ea6742a5311eef7f2c79c0037c0`.
2. **Fresh shallow clone of `main`** — merge commit `a0925ab`, two parents
   (`a86bd1b` + `2a1dcc1`). `supabase/migrations/0041_lock_resume_and_farah_columns.sql`
   present, and its four executable statements confirmed in the clone: the
   `revoke update on public.resumes`, the
   `grant update (title, source, structured_content, updated_at)`, and the two
   revokes on `farah_messages` and `referral_shares`. The new tests are on `main`
   too (`column-privileges.test.ts:621`, `:718`).
3. **Live probe** — both bypass queries re-run against production from a real
   authenticated session (0 credits, 0 unlocks):
   ```
   BYPASS 1  resumes.template_id write        -> 42501 permission denied for table resumes
             template_id: null (unchanged)
   BYPASS 2  farah_messages.created_at backdate -> 42501 permission denied for table farah_messages
             quota count: 1 before, 1 after
   CONTROL   saveResumeAction's columns        -> works
   ```
   The control is load-bearing: a fix that also broke the builder's save would
   have been worse than the bug.
4. **CI green** — 21/21 files, **272/272 tests** (up from 267; the five new
   column-privilege cases), `column-privileges.test.ts` 25/25, Playwright 13/13.
   All four checks passed on the PR head and on the merge commit.

### Proof the tests catch it

Against unfixed code four fail — `MONEY: cannot apply a premium template by
writing template_id directly`, the `is_base`/`user_id` case, `COST: cannot
backdate its own messages to clear the hourly quota`, and the `role` relabel.
One of those caught a subtlety worth keeping: the enum is `"user" | "farah"`,
not `"assistant"`, so the first draft of the relabel test was passing because
Postgres rejected an invalid enum value rather than because the grant refused it
— passing for entirely the wrong reason.

### The class now has a running count

This is the **sixth and seventh** instance: 0028, 0030, 0031, and now 0041 twice
over. Every one was found by this same sweep and every one had been live in
production. The working prior should now be that **any new user-writable table is
exposed until proven otherwise** — Supabase's default `GRANT UPDATE ON ALL
TABLES` makes exposure the default state, and only an explicit column grant takes
a table out of it.

---

## Merged 2026-08-25 — PR #39, schema.org/JobPosting ingestion

Closes the second half of M2/§6.12. Arrived as a patch file (`git am`, authorship
preserved: `Claude <noreply@anthropic.com>`), then four follow-up commits from
review.

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#39](https://github.com/Bayo-1987/Claude-Talentrah/pull/39) | `feat/schema-org-job-ingestion` | 17:10:04 | `6326d72` |

7 commits, 16 files, +1288/−35.

### What shipped

`src/lib/jobs/sources/schema-org.ts` — a two-step fetcher (a listing page's
`ItemList` JSON-LD → each job's own `JobPosting` block) wired into `ingest.ts`'s
existing dispatch/dedup/freshness pipeline. One vetted pilot source:
`jobs.workable.com/search/nigeria`. `JobSourceConfig` and
`NormalizedJobPosting.externalSource` became a three-way discriminated union.

It also carries **the only timeout on any external call in this repo**
(`AbortSignal.timeout`, 15s). The "no external call anywhere sets a timeout"
gap in the backlog is otherwise untouched.

### Source eligibility — the part that carries legal weight

Four candidates were checked and rejected before Workable qualified. Three were
taken on the patch's word; **Fuzu was re-verified independently**, because the
whole disqualification rests on it and it is the one claim with real legal
consequence if wrong.

`fuzu.com/legal/terms` sits behind a Cloudflare challenge (HTTP 403). No attempt
was made to defeat bot-detection; the page was read in an ordinary browser.
**§12 "Acceptable use", Global Terms v2, last updated 1 June 2026** — both
phrases present verbatim, not paraphrased:

> ...use automated tools to scrape or misuse platform data...

> ...misuse Candidate or Employer data, including by selling, redistributing, or
> aggregating it without authorisation; scrape, harvest, mine, or extract
> platform data without authorisation, or train any third-party AI System on
> Content obtained from the Service without authorisation...

The actual text is **broader than the patch claimed**: the patch framed the ban
as scoped to Candidate/Employer data, but there is a standalone prohibition on
scraping or extracting *platform data*, plus an explicit ban on training
third-party AI on Fuzu content. Job listings are squarely inside it. Fuzu's
`robots.txt` carries no AI-crawler restriction at all — which is the point:
robots.txt permissiveness is not a redistribution licence.

Workable's `robots.txt` was re-verified too:
`Content-Signal: search=yes, ai-input=yes, ai-train=no`, `Allow: /search/*`, no
disallow covering `/view/*`. A live posting was confirmed to carry every field
the fetcher requires.

### The closure-discriminator bug — a real live defect, not a design nit

**This one reached production during review and closed 20 real job postings.**
Recorded in full because smoothing it into "review found some improvements"
would misrepresent what happened.

The freshness sweep scoped a schema.org source's closure by
`external_source = 'schema-org'` — the bare discriminator, shared by *every*
schema.org row in the table. greenhouse/lever get a second predicate
(`company_name`) that scopes them to their own board; a multi-employer
schema.org source has no such column and got nothing.

It was first written up as latent — "fine with one source, breaks the moment a
second is added." **That was wrong.** Any schema.org ingest closed every
schema.org row it had not just seen, and *a test counts as an ingest*. Running
the new `tests/jobs/ingest-schema-org-multi-source.test.ts` against the unfixed
code closed all 20 real Workable postings in the live project, because its
mocked sources have no real postings of their own so every genuine row looked
stale to their sweep. There is no staging database; that is why a test reached
real data.

Fix: `external_source` is now `schema-org:<label>`, produced by one function
(`schemaOrgSourceKey` in `types.ts`) that both the upsert and the closure query
call, so writer and sweep cannot drift apart. Before changing it, every reader
of the column was re-checked against then-current `main`: the only ones are
`ingest.ts`'s own write and closure query. The UI branches on
`source_type === "external"` (`src/components/jobs/job-card.tsx:36`), never on
`external_source`'s value. No RLS policy, index or constraint references it —
plain nullable `text`.

Proof, both directions:

```
pre-fix   × CROSS-SOURCE CLOSURE: source B closed 2 of source A's postings
          × A's still-listed posting must stay open: expected 'closed' to be 'open'
          live project: 20 real Workable rows → all closed by a test ingest

post-fix  11/11 jobs tests pass
          live project: 20 real Workable rows → all still open
```

The test carries a positive control, so "nothing ever closes" cannot satisfy it.

### Three other defects found and fixed during review

- **The DB test could never have passed.** `tests/jobs/ingest-schema-org.test.ts`
  stubbed the *global* `fetch`, which supabase-js also uses, so its mock threw
  on Supabase's own REST calls — contradicting the file's own docblock ("Network
  is mocked; Supabase is not"). The patch flagged it as unrun for lack of
  `SUPABASE_SERVICE_ROLE_KEY`; the key was available here, the file ran for the
  first time, and failed immediately. Now passes through to the real fetch for
  anything that is not a test-owned URL.
- **`scripts/seed.ts` would have logged `greenhouse/undefined`.** It re-declared
  the route's response shape inline, so the `token` → `identifier` rename kept
  compiling. Replaced with a type-only import of the real `IngestSourceResult`.
- **`ledgerFor` in the referrals suite reported failed queries as empty
  results** (`data ?? []`), which produced one false assertion failure. Now
  throws. A helper that cannot tell "no rows" from "the question was never
  answered" will eventually blame the code for the network.

### Migrations 0039 and 0040 (both applied, both in `list_migrations`)

- **`0039_qualify_schema_org_source_key`** (`20260825162806`) — re-labels
  pre-existing bare `schema-org` rows. Guarded: raises rather than mislabel
  anything that is not a `jobs.workable.com` URL. Needed because a row already
  delisted is never re-upserted, so it would never match the new sweep and would
  sit `open` forever. A permanently live listing for a dead job is worse than a
  missing one — someone spends an application on it.
- **`0040_reopen_test_closed_workable_rows`** (`20260825163103`) — reopens the 20
  the pre-fix test run closed. All 20 were re-checked against the live listing
  first; all 20 still there.

### Verified, four-point standard

1. **PR API** — `merged: true`, `merged_at 2026-08-25T17:10:04Z`,
   `merge_commit_sha 6326d722cfe61f1b28c833309dfa12ec009d88fb`.
2. **Fresh shallow clone of `main`** — merge commit `6326d72` with two parents
   (`e373aa3` + `215f69f`), matching this repo's merge-commit style. All new
   files present; `externalSourceKey(config)` confirmed in the merged
   `ingest.ts:120`, `schemaOrgSourceKey` in `types.ts:64`, `hookTimeout: 60000`
   in `vitest.config.ts:30`.
3. **Live probe** — `/` 200, `/login` 200, `/signup` 200, and the admin surface
   still fail-closed at 401. Database: exactly **20 open
   `schema-org:workable-nigeria` rows, zero bare `schema-org`**, greenhouse
   untouched at 127 open / 10 closed.
4. **Full suite green in CI** on the merged head `215f69f`: **21/21 files, 267/267
   tests**, plus **Playwright 13/13**. All four checks passed. Independently
   re-run locally against merged `main` (`c79f177`) once CI had finished and
   nothing was contending for the database: **21/21 files, 267/267, exit 0**.
   Two uncontended runs agreeing is also what rules out the alternative reading
   of the flakiness below — that the raised `hookTimeout` is masking a real
   problem rather than absorbing contention.

### The suite's own flakiness was self-inflicted — worth remembering

Two local full-suite runs failed with 14 tests across 9 files, every failure
pinned at exactly the hook timeout (`10008ms`, `10002ms`, `10512ms`). It was
first blamed on Supabase's auth rate limit. **That was wrong** — a direct probe
on a quiet database measured `createUser` at ~750ms and a plain select at 234ms.

The real cause: 21 test files run in parallel against the shared live project,
**and CI runs against that same project at the same time**. The CI record shows
it — commits whose local runs overlapped CI failed the unit job, and the
Playwright failure on `aa44e1c` was literally `AuthRetryableFetchError: Gateway
Timeout` at 16:52, mid-way through a local run.

Two consequences, both kept:

- `vitest.config.ts` now sets `hookTimeout: 60000`. Three files had already been
  patched with a per-hook `, 60_000` — one fix applied three times while leaving
  every other suite exposed. A raised ceiling does not hide a hang; a genuinely
  stuck hook still fails, just at 60s.
- **Do not run the full suite locally while CI is running on the same branch.**
  There is one database and both will fight for it.

Related, and not an anomaly: a real ingest against the live project at
`16:20:07` (127 greenhouse rows re-checked, 20 Workable rows created) was **CI's
own `npm run seed` step** — a CI run on this PR ran 16:16:10Z–16:22:16Z, which
brackets it. Per CLAUDE.md, `seed` drives real ingestion over HTTP precisely
because there is no staging database. The 20 rows are genuine, currently-live
postings and were deliberately kept rather than deleted and re-ingested.

### Still one pilot source, not a green light

Workable is one well-vetted source. Adding more via the same mechanism, or
relying on schema.org as a *primary* supply channel, remains gated on the legal
review build-prompt §10 item 10 names. Read `sources.config.ts`'s comment before
adding a second.

---

## Merged 2026-08-25 — PRs #35, #36, #37

All three verified by the four-step standard above.

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#37](https://github.com/Bayo-1987/Claude-Talentrah/pull/37) | `fix/api-contract-layer` | 14:48:38 | `b605435` |
| [#36](https://github.com/Bayo-1987/Claude-Talentrah/pull/36) | `fix/tracker-stage-transitions` | 14:54:50 | `66edb12` |
| [#35](https://github.com/Bayo-1987/Claude-Talentrah/pull/35) | `fix/referral-self-referral-dots` | 14:57:35 | `61fc8db` |

Merged **#37 first**, out of the suggested #35 → #36 → #37 order, for two
reasons: its exposure was live and unauthenticated, and its regenerated
`src/lib/supabase/types.ts` is a strict superset of #35's, so landing it first
turned a hand-merge into a `--theirs` take.

### PR #37 — API contract layer

Closed a **live, unauthenticated production exposure**. Verified open
immediately before the merge and closed immediately after:

```
before   GET  /api/admin/moderate-scholarship          -> 200  (full pending queue)
         POST /api/admin/estimate-llm-costs?group=bogus -> 400  (validation, not auth)

after    GET  /api/admin/moderate-scholarship          -> 401  {"error":"Unauthorized"}
         GET  /api/admin/ingest-scholarships            -> 401
         GET  /api/admin/ingest-jobs                    -> 401
         GET  /api/admin/renew-passes                   -> 401
         POST /api/admin/estimate-llm-costs?group=bogus -> 401
```

The `400 → 401` inversion on the last one is the specific proof the guard now
runs *before* argument validation, rather than being skipped.

Public surface re-checked for a 0032-style regression: `/` 200, `/login` 200,
`/signup` 200, `/jobs` 307 → `/login` (the normal auth gate, not breakage).

Also in #37: atomic per-user rate limiting on `/api/tailoring` and
`/api/resume/parse` (migration `0038`), no handler returning raw `err.message`,
a guard on `request.formData()`, and job ingestion finally scheduled
(`0 5 * * *`).

### PR #36 — tracker stage transitions

Migration `0037`. `hired → anything but archived` is now a database trigger,
because `applications` carries a permissive owner-only policy that makes an
app-layer check bypassable. Also adds the shared retrying auth-test helper
(`tests/support/auth.ts`) and the missing cross-user UPDATE tests.

### PR #35 — self-referral via dotted Gmail aliases

Migration `0036`. Dots are stripped for `gmail.com`/`googlemail.com` only,
since other providers treat them as significant.

### Conflicts resolved during the merges

- `tests/rls/org-and-referral-scoping.test.ts` (#36 ↔ #37): both branches had
  **independently found and fixed the same fixture bug** — its `.limit(1)` had
  started selecting a real unverified org's posting, so the suite reported
  0027's verification gate working correctly as a regression. Identical code
  fix on both sides; kept #36's fuller comment and dropped #37's duplicate.
- `src/lib/supabase/types.ts` (#35 ↔ #37): both regenerated it. Took `main`'s
  copy wholesale after asserting it is a superset — `normalize_email_for_self_referral`,
  `org_application_counts`, `consume_rate_limit`, `spend_credits_atomic`,
  `auto_apply_claim_submission` and the rest all present.

### Correction to the incoming backlog

The backlog described all three PRs as green. **#35 was not.** Its
"Typecheck, lint, unit tests" check had *failed* and Playwright was skipped as
a result. The cause was the shared-fixture bug above, not the referral change;
merging `main` into the branch cleared it and all four checks then passed.

---

## Post-merge: test teardown fix (`fix/teardown-timeout`)

The full suite on merged `main` reported a failed *file* while all 209 tests
passed — `tests/credits/spend-race.test.ts`'s `afterAll` blew vitest's 10s hook
budget deleting its throwaway accounts one round-trip at a time. The timeout
aborts the loop partway, so the hook leaks exactly the accounts it exists to
remove, into the shared project, because **there is no staging database**.

Deletions are now parallel with an explicit 60s hook timeout, in that suite and
in `tests/api/rate-limit.test.ts` which had the same shape. Suite is 209/209
green.

Two orphaned accounts from earlier runs remain (`rls-*`, `employer-*`) against
7 real users. Not enough to slow anything; recorded so the number can be
watched rather than rediscovered.

---

## Environment variables the founder must set

Not code changes — these need someone with account access.

| Variable | Where | Why it matters now |
|----------|-------|--------------------|
| `INGEST_SECRET` | Vercel **Production** | **New and load-bearing after #37.** The admin routes now fail closed, which is the point — but every manual admin trigger answers 401 until this is set. Also needed in `.env.local`, because `npm run seed` drives the real ingestion route over HTTP. |
| `CRON_SECRET` | Vercel **Production** | Unconfirmed. Three crons now depend on it (job ingestion 05:00, Pass renewal 06:00, scholarship ingestion 07:00 UTC). No cron has ever been *observed* firing. |
| `GEMINI_API_KEY` | Vercel **Production** | The key on file is free-tier: 20 requests/day, shared. AI features hard-fail past that. |

Leaked-password protection remains a Supabase **dashboard-only** toggle with no
MCP or CLI path. Carried forward, deliberately not worked around.

---

## Missing input documents

The priority backlog dated 2026-08-25 refers to roughly fifty prompt files in
this directory. **None of the following exist** — checked in the repo root and
across `~/Desktop`, `~/Documents` and `~/Downloads`:

- `handoff-status.md` (this file now stands in for it)
- `schema-org-job-ingestion-prompt.md` — backlog item 2
- `test-scenarios-job-feed-matching-prompt.md`
- `test-scenarios-external-api-integrations-prompt.md`
- `test-scenarios-employer-prompt.md`
- `test-scenarios-scholarships-prompt.md`
- `test-scenarios-resume-builder-prompt.md`
- `test-scenarios-tailoring-credits-payments-prompt.md`
- `test-scenarios-auth-onboarding-prompt.md`
- `talentrah-gtm-brief.md`, `competitive-landscape-brief.html`,
  `pricing-validation-prep-prompt.md`

Present and readable: `CLAUDE.md`, `talentrah-build-prompt.md`,
`talentrah-editorial-design-handoff.md`, `Main-Editorial.dc.html`,
`JobFeed-Editorial.dc.html`, and the plan at
`~/.claude/plans/adaptive-giggling-ember.md`.

The backlog's one-line summaries of each missing brief are enough to *work
from* — but not enough to honour instructions like "read its §0/§1 before
touching a source," which for the schema.org brief carries the source-eligibility
rules. Those need the real files.

---

## Open backlog

1. ~~Merge #35, #36, #37~~ — **done**, verified above.
2. ~~schema.org/JobPosting ingestion~~ — **done**, PR #39, see above. Arrived
   as a patch rather than being built here. One pilot source
   (`jobs.workable.com/search/nigeria`); `hotnigerianjobs.com`, `jobberman.com`,
   `myjobmag.com` and `fuzu.com` all checked and rejected, Fuzu's ToS
   independently re-verified. Broader reliance still gated on §10 item 10.
3. **Six remaining test-coverage briefs**, in the backlog's severity order.
   Also blocked on missing files, though the one-line summaries name the
   defects. Highest-value leads from those summaries:
   - Cross-source dedup hash collisions destroying a posting's apply link.
   - A transient empty-200 ingest response mass-closing a source's live postings.
   - A Paystack blip being indistinguishable from a real decline, permanently
     killing a paying customer's auto-renewal; **no external call anywhere sets
     a timeout**.
   - Duplicate org names/domains unguarded — the second owner's org becomes
     permanently unmanageable.
   - ~~Premium-template gate bypassable via a direct `PATCH` to
     `resumes.template_id`~~ — **done**, PR #40 / migration 0041. Confirmed live
     and fixed; the sweep also found and fixed the Farah rate-limit bypass.
   - A zero-width character defeating the "no name yet" guard, reopening the
     PR #21 bug through a character class `.trim()` does not cover.
   - `e2e/employer.spec.ts` flake — the concrete lead is a live-shared-database
     race between concurrent CI runs, not Playwright parallelism (the config
     already rules that out).

Items already closed that these briefs still describe as open — confirm, don't
re-diagnose: the ingestion trigger's fail-open (#37), the `spendCredits` race
and the scholarship credit try/catch gap (#34), and the resume-builder
credit-spend race (#34).
