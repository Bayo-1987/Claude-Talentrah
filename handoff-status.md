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

## Merged 2026-10-01 — S12 job data quality, parts 3 and 4: PR #638 (cleaned location text) and PR #634 (job page titles)

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#638](https://github.com/Bayo-1987/Claude-Talentrah/pull/638) | `feat/job-location-normalise` | 2026-10-01 16:24:01 | `0f60fa2cd25d40b41e819aaca6ed491b1cff6cb1` |
| [#634](https://github.com/Bayo-1987/Claude-Talentrah/pull/634) | `feat/job-page-titles` | 2026-10-01 17:29:22 | `aa55eb6fc64b72c6c3bb67194cdf96811ff5eb3b` |

**What #638 changed.** `normalizeLocation` (`src/lib/jobs/location.ts`) cleans the stored `location` text at ingestion in all four adapters: a part repeating an earlier part of the same entry is dropped (`Lagos, Lagos, Nigeria` -> `Lagos, Nigeria`), duplicate `;` entries, a trailing ISO code that is that country's own (`Cameroon (CM)`), a stray full stop, ragged spacing, and a template placeholder (`City, Country`) becomes no location. It never invents or reorders and is idempotent. **Identity does not move**: every adapter still computes `dedup_fingerprint` from the raw string. No migration, no data written; rows take the cleaned text on their next ingest.

**What #634 changed.** The `/jobs/[id]` title is `<Role> at <Company> — <City or Remote> | Talentrah` (`src/lib/seo/job-page-title.ts`), about 65 characters, under the founder's policy of 2026-10-01: **the company is never dropped**. Trim order: the suffix, then the place is the city or `Remote`, then the role at a word boundary; past that the title runs long. A posting whose title equals a sibling's (one bounded query per page render, `siblingPostingsFor`) gets its country, and only those, in a form that is never shortened (shortening the role would rebuild the collisions). `og:title` and `twitter:title` are that same string; canonical and the rest of the head are unchanged.

### Verification (all four, against live state)

**1. API.** `…/pulls/638` -> `merged: true`, `merged_at` 2026-10-01T16:24:01Z, `merge_commit_sha` `0f60fa2c…`. `…/pulls/634` -> `merged: true`, `merged_at` 2026-10-01T17:29:22Z, `merge_commit_sha` `aa55eb6f…`.

**2. Fresh shallow clone** (`GIT_TERMINAL_PROMPT=0 git clone --depth 1`), HEAD `aa55eb6fc64b72c6c3bb67194cdf96811ff5eb3b`: PRESENT `src/lib/jobs/location.ts`, `tests/jobs/normalize-location.test.ts`, `src/lib/seo/job-page-title.ts`, `tests/seo/job-page-title.test.ts`, `e2e/job-page-title-head.spec.ts`; `siblingPostingsFor` appears 2 times in `src/app/(app)/jobs/[id]/page.tsx`; `normalizeLocation` appears 2 times in each of the four adapters.

**3. Live production probe** (signed out, 2026-10-01 after Vercel deployments `dpl_23SiXw9NMdkcqkRWnuFmkotxJtVB` (#638) and `dpl_FaWbHPs8sVScnDGarULTCpZTcbdE` (#634, `githubCommitSha` `aa55eb6f…`), both `READY`, `target: production`). A crawl of **all 380 job URLs in `sitemap.xml`** (title, `og:title`, canonical): **380/380** `<title>` equal `og:title`; **380/380** canonicals are the page's own path; **0** still in the old `— Talentrah` format; 142 carry the ` | Talentrah` suffix, 74 carry a country (`— Remote, Poland`), the rest the short place. Duplicate titles: **3 groups / 7 rows** (Optimal Group x3, Monaco Solicitors x2, and Sales Network Manager - Regional - Jumia x2 in Nigeria, two postings with the same company, role and location). The first two are the rows #632 supersedes (once marked: 1 group / 2 rows left, the Jumia pair, which no title can separate). **58 titles are over 65 characters, 40 over 70, the longest 100**: the policy lets a title run long rather than lose its company, and the unshortened country-bearing form is the long one. The SQL estimate before the change was 28 duplicate groups / 107 rows and 120 titles over 65 (the founder's own crawl is the authoritative before/after). Production database, read-only, **before the next ingest** (so these are the "before" numbers for #638 and #629): open external postings with a repeated location part **126**, with a trailing ISO code **9**, bare `Remote` **62**, `Remote, <country>` **77**.

**4. Test suites on the merged heads.** #638's final head: unit 410 files passed (410), Playwright 512 passed. #634's final head: unit 415 files passed (415), Playwright 517 passed, including the new `e2e/job-page-title-head.spec.ts` (title = `og:title` = `twitter:title`, and a real Poland/Spain collision).

### Not covered / open
- **#638's effect on data is not yet observable**: the last production ingest ran at 12:07Z, before both deploys. After the next run: the repeated-part, ISO-code, bare-Remote and Remote-country counts above should fall to 0 / 0 / (Workable rows that state a country) / rise; the before/after on the 142 markup-ineligible rows and the Rich Results test on 3 remote jobs follow it.
- The title duplicate count above is on **unmarked** data; marking the 3 superseded rows is still waiting on the founder's go.
- Lighthouse failed on both PRs (known: the thin CI-project `/jobs/remote` 404); not a required check. The SQL replica of the title rule is an approximation of the TypeScript; the crawl above is the real measurement.
- One `tests/jobs` file (`freshness-visibility`) fails locally against the shared test database on remote-posting counts (other sessions' data); it passed in CI on both heads.

---

## Merged 2026-10-01 — S12 job data quality, parts 1 and 2: PR #629 (countries and Workable's stated remote country in JobPosting markup) and PR #632 (superseded duplicates, migration 0202)

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#629](https://github.com/Bayo-1987/Claude-Talentrah/pull/629) | `fix/jobs-location-country-jsonld` | 2026-10-01 14:26:31 | `dbf0af19c1159e7719dd3452d55e3a6fd47093c2` |
| [#632](https://github.com/Bayo-1987/Claude-Talentrah/pull/632) | `feat/job-supersession` | 2026-10-01 15:09:30 | `1c263fad6c583eaf7f3582e668f00fd90371ea75` |

**What #629 changed.** `src/lib/jobs/countries.ts` (the 249 ISO 3166-1 names as committed CLDR data, plus an explicit, tested alias table; `Georgia`, `Jersey` and `Congo` never resolve from free text). `parseJobLocation`: a lone country token is a country-only address, a remote role gets `TELECOMMUTE` + `applicantLocationRequirements`; `Remote, Bangalore` no longer claims a country called "Bangalore". Workable's `formatLocation` keeps the Country the source states (`Remote, Nigeria`), never invents "Worldwide", and the row's `dedup_fingerprint` is computed from the pre-enrichment location so no live row changes identity. No migration, no data written: existing rows take the new location text on their next ingest (daily 05:00 UTC).

**What #632 changed.** Migration `0202` (applied to production BEFORE the merge, 2026-10-01 ~15:00 UTC, after the PR's required checks were green on its head): `job_postings.superseded_by` / `superseded_at`; the public SELECT policy gains `superseded_at is null` in each of the four non-member branches (self-checked: four mentions); a trigger refusing the columns from `authenticated`/`anon`; `job_supersession_plan(p_companies)` (the dry run) and `apply_job_supersession(p_companies)` (the write), service-role only; `superseded_job_target(id)`; `auto_apply_claim_submission` and `promoted_jobs` redefined with one added condition each; the `job_supersession` feature flag, created OFF. App side: service-role readers that bypass RLS exclude superseded rows (Auto-Apply scan, digest, win-back, proactive alert, match refresh, LLM enrichment) with `tests/jobs/supersession-read-paths.test.ts` as the standing check; `/jobs/[id]` answers 308 to the kept row; ingest runs `apply_job_supersession` scoped to the companies it touched, only while the flag is on. **Nothing is marked in production.**

**Found by measuring (both are in the PR).** The 308 was a **404** on a real `next build && next start` until the redirect check moved into the page body as well as `generateMetadata`: the body runs concurrently and its `notFound()` won the race. And a global `apply_job_supersession` was unsafe for parallel test files sharing one database (my own ingest test marked another file's fixtures), hence the `p_companies` scope. CI on #632's first head also failed 20 unit tests in 5 files, because their hand-written Supabase fakes had no `.is()`; fixed, and win-back's fake now has a mutation-checked test that a superseded copy is never emailed.

### Verification (all four, against live state)

**1. API.** `GET /repos/Bayo-1987/Claude-Talentrah/pulls/629` -> `merged: true`, `merged_at` 2026-10-01T14:26:31Z, `merge_commit_sha` `dbf0af19…`. `…/pulls/632` -> `merged: true`, `merged_at` 2026-10-01T15:09:30Z, `merge_commit_sha` `1c263fad…`.

**2. Fresh shallow clone** (`GIT_TERMINAL_PROMPT=0 git clone --depth 1`), HEAD `1c263fad6c583eaf7f3582e668f00fd90371ea75`: PRESENT `supabase/migrations/0202_job_posting_supersession.sql`, `src/lib/jobs/countries.ts`, `tests/jobs/supersession.test.ts`, `tests/jobs/supersession-read-paths.test.ts`, `e2e/job-superseded-redirect.spec.ts`, `tests/jobs/country-resolver.test.ts`; `supersededTargetFor` appears 3 times in `src/app/(app)/jobs/[id]/page.tsx`; `superseded_at` 21 times in the migration.

**3. Live production probe** (signed out, 2026-10-01, Vercel deployment `dpl_Em1XVS6nedVoL61aaiwmr5vAGUuZ`, `READY`, `target: production`, `githubCommitSha` = `1c263fad…`): `/`, `/jobs`, `/jobs/remote`, `/jobs/remote/nigeria`, `/jobs/in/lagos` and a sitemap-listed `/jobs/<id>` all 200; `sitemap.xml` 200 listing 380 job URLs. Production database, read-only: both columns present, **0 rows marked**, the policy mentions `superseded_at` 4 times, flag `job_supersession` = false, `anon` cannot execute `apply_job_supersession`, `anon` can execute `superseded_job_target`, `authenticated` kept `EXECUTE` on `promoted_jobs`, `job_supersession_plan()` returns exactly the 3 dry-run rows, 662 open postings unchanged.

**4. Test suites on the merged heads.** #629's final head: unit 404 files passed (404), Playwright 495 passed. #632's final head: unit 407 files passed (407), Playwright 496 passed, which includes the new `e2e/job-superseded-redirect.spec.ts` (308 on the built app) and the database tests that could not mint an authenticated session locally.

### Not covered / open
- **Marking the 3 rows waits for the founder's yes** on the dry-run list (Optimal Group x2, Monaco Solicitors x1; none has an application or a queue entry). After it: probe `/jobs/remote`, the country and city pages (a hidden row can lower a facet below `LANDING_PAGE_MIN_ENTRIES`) and the old URLs' 308. The flag stays off until asked about separately.
- **#629's effect on data is not yet observable**: the Workable remote rows take "Remote, <country>" on the next ingest (05:00 UTC, 2 Oct). Before/after on the 142 markup-ineligible rows (62 bare Remote, 80 single token) and the Rich Results test on 3 remote jobs are due then.
- The Lighthouse check failed on both PRs (the known thin-CI-project `/jobs/remote` 404, CLAUDE.md's third consequence) and Vercel reported a build-rate-limit failure on #629; neither is a required check.
- Authenticated-session tests could not run locally against the test project (`No suitable key or wrong key type`); CI's ephemeral stack was their first run. The `INSERT` guard trigger's own test could not be mutation-checked (dropping a trigger on the shared test project was refused by the permission layer); it asserts the trigger's own message, which nothing else raises.

---

## Merged 2026-10-01 — PR #604, the seven font families self-hosted so `next build` never asks Google for a font (refs #585)

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#604](https://github.com/Bayo-1987/Claude-Talentrah/pull/604) | `chore/self-host-fonts-585` | 2026-10-01 05:58:11 | `2aa8ba294104f0175b4acd10a65bc37cbf3775d3` |

**What it changed.** `next/font/google` fetched every font from Google while `next build` ran, and Turbopack fails the whole
build when one fetch fails ("Can't resolve '@vercel/turbopack-next/internal/font/google/font'"): nine CI builds died that way on
2026-09-29/30, before any test ran (#585). The 60 woff2 files (1.27 MB, every unicode-range subset, byte-for-byte what Google
served) are now committed under `src/fonts/` with each family's `@font-face` CSS, its `OFL.txt`, a README and a `manifest.json` that
pins each file's sha256. No migration, no production data touched.
- The files are referenced from CSS `url()`, so the bundler hashes them into `/_next/static/immutable/media/` with the same
  `cache-control: public,max-age=31536000,immutable` as before. `layout.tsx` preloads the same three files through `react-dom`'s
  `preload()` (a `<link rel=preload>` in the tree is emitted twice). The exported font objects keep their `{ className, variable, style }`
  shape and the `--font-*` names, so `typefaceVariable` and `fontScopeClassName` are untouched.
- Guard `tests/fonts/no-google-font-fetch.test.ts`: nothing under `src/` or `next.config.ts` may mention `next/font/google` or the Google
  font hosts, except one named entry, `src/lib/seo/og-card.tsx` (a server-side ttf fetch per share-card request; falls back on failure).
  Red on `main` before the change, on exactly four sites (CI run 36776217412), green after.
- `next.config.ts` no longer claims that no runtime request to a Google font host exists (the OG card makes one).
- Removed the vitest `next/font/google` alias and stub (nothing imports it).

**What was proved before merge** (details in the PR): a throwaway same-runner workflow built the PR's base and the branch side by
side against one database. The 60 served files, the 169 unique `@font-face` blocks (including the 7 fallback blocks), the `--font-*`
rules and the class rules were **identical**; the 1,170-row extraction probe was identical main vs branch and to the committed
`results-wordspacing-fine.csv`; `pdffonts` and `pdftotext -raw` hashes matched for all 1,170 PDFs; 30 screenshot views at 1440/768/375
differed by **0 pixels**. A production build with both Google hosts unreachable **succeeds on the branch and fails on main** with the
#585 signature. Two real differences the comparisons found (a dropped `font-stretch: 100%` on IBM Plex Sans, and every preload emitted
twice) were fixed first. CLS (median of 10 cold loads) was equal in two scenarios and 0.0013 vs 0.0012 in the third (the same two
values, split differently; accepted as noise).

### Verification (all four)

**1. GitHub API** — `GET /repos/Bayo-1987/Claude-Talentrah/pulls/604`:
```
{"merged": true, "merged_at": "2026-10-01T05:58:11Z",
 "merge_commit_sha": "2aa8ba294104f0175b4acd10a65bc37cbf3775d3", "state": "closed", "base": "main"}
```

**2. Fresh clone** (`git clone --depth 1 --branch main`, temp dir; `main` was at `c885fc5`, which contains the merge):
```
PRESENT 60 woff2 under src/fonts (60)
PRESENT every file matches its manifest sha256 (mismatches: 0)
PRESENT <slug>/OFL.txt + <slug>.css for newsreader, ibm-plex-sans, poppins, work-sans, lora, barlow-condensed, source-sans-3
PRESENT layout.tsx: no next/font import
PRESENT layout.tsx: preload() of PRELOADED_FONT_URLS
PRESENT tests/fonts/no-google-font-fetch.test.ts, tests/fonts/self-hosted-fonts.test.ts, e2e/self-hosted-fonts.spec.ts
PRESENT vitest.config.ts has no next/font alias;  tests/stubs/next-font-google.ts removed;  .gitattributes pins src/fonts/** -text
```

**3. Live production probe** (signed out, real browser, 2026-10-01 ~13:00 UTC, production `www.talentrah.com`, which has since moved on
to later merges that all contain this one). The Vercel deployment for the merge commit is `dpl_CcAJ8qzxEdepXeUyyZYBfh1XAeUR`
(`READY`, `target: production`, created 05:58:14, `meta.githubCommitSha` = `2aa8ba29…`). On each of `/`, `/about` and `/scholarships`:
- **3 `<link rel=preload as=font>`, all different, each fetched exactly once** (the Newsreader normal and italic latin files and the IBM
  Plex Sans latin file); a fourth file (`ibm-plex-sans-…-latin-ext-…`) loads on demand because the page has characters outside latin;
- every font request came from `/_next/static/immutable/media/`, and a re-fetch of each returned `public,max-age=31536000,immutable`;
- **0 requests to `fonts.googleapis.com` or `fonts.gstatic.com`** (resource timing), 0 faces in the `error` state
  (`/`: 15 loaded, `/about`: 10, `/scholarships`: 8);
- the three files production serves hash to manifest entries (`ibm-plex-sans-normal-latin-w400_500_600_700-056e4e24`,
  `newsreader-normal-latin-…-2a69ec1c`, `newsreader-italic-latin-…-19a83cc7`), and are the same byte sizes as before the change.
- **Limit, stated plainly:** no signed-out route renders a resume template (`/resume-builder` and `/tailor` redirect to `/login`, the
  `/dev/…` probe routes are 404), and signing in to production was out of bounds, so the template families (Poppins, Work Sans, Lora,
  Barlow Condensed, Source Sans 3) were **not** observed in a live browser. They rest on the same-runner proof above (0-pixel diffs on
  5 templates covering all six typeface tokens, identical built CSS) and on the CI e2e run.

**4. Full suite against merged `main`** — CI run
[36822342743](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36822342743) (head `2aa8ba29`):
```
Typecheck, lint, unit tests : success   Test Files 382 passed (382)   Tests 4339 passed (4339)
Playwright e2e              : success   418 passed (8.6m)   (includes e2e/self-hosted-fonts.spec.ts)
Secret scan                 : success
Dependency audit            : success
Migration numbering         : skipped (no migration in the diff)
```

### Not covered / still open
- **#585 stays open.** It closes when a 48 h tally shows no `Build app` font failures on runs whose tested commit contains `2aa8ba29`
  (`scripts/ci-flake-tally.py --mode font`, added in #603).
- The OG card's runtime ttf fetch is the one remaining reference to a Google font host (allowlisted, server-side, cannot fail a build).
- The repo grew by ~1.3 MB; the fonts no longer follow Google's updates (`node scripts/self-host-fonts.mjs --check` shows a change as a diff).

---

## Merged 2026-10-01 — PR #615, tailoring and bullet rewrite update the masthead balance; every other credit spender proven to refresh (send-489, issue #605)

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#615](https://github.com/Bayo-1987/Claude-Talentrah/pull/615) | `fix/credit-balance-live-all-spenders-489` | 2026-10-01 10:48:12 | `1f275f5a7d5926d1d3ccbb6dfceb071522c42e05` |

Finishes issue [#605](https://github.com/Bayo-1987/Claude-Talentrah/issues/605) after #609 fixed Farah chat: **after a credit-paid action the masthead
kept showing the pre-charge balance** (the ledger and `profiles.credits_balance` were right; display only). The audit posted on the issue listed every
seeker spender; this PR fixes the two that were stale and **proves, by measurement, that the rest already refresh**. No migration; **charging logic
unchanged** (every spend assertion is a pass-through of the existing `spendCredits` contract).

**What it changed.**
- `commitTailoringAllowance` (`src/lib/tailoring/gate.ts`) returns `{ balanceAfter }`: the **ledger's own `balance_after`** for a spend (what
  `spend_credits_atomic` computed under its lock), never `balance_at_check - cost`; `null` for a free trial or Pass. `/api/tailoring` responds with
  `creditsBalance`, the **last** spend's balance across the tailoring and cover-letter legs (a free leg falls back to the earlier one).
- `rewriteBulletAction` returns `creditsBalance` for a paid rewrite and omits it otherwise (Pass, failure, unaffordable).
- `tailor-form.tsx` and `resume-editor.tsx` report it through the `credits-balance` provider #609 added; the masthead shows it without a reload and drops
  the override as soon as the server hands down a different number.

**The audit's other spenders, measured.** `e2e/credit-balance-live.spec.ts` (9 tests; each asserts the charge is **exactly** the `CREDIT_COSTS` price, the
pill equals the post-charge **database** balance, and a `window` marker survived so the page was not reloaded) was first run against **unfixed `main`** on
a throwaway PR (#616, run [36843712178](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36843712178), closed and its branch deleted): **exactly two
were red**, tailoring / cover letter and bullet rewrite. **Green on unfixed main, so confirmations and not fixes:** both scholarship actions on the
**detail page and the list page**, Auto-Apply confirm (free weekly allowance used up), and Talent Directory verification, human review and boost. Each
calls `revalidatePath` after the spend, which re-renders the layout.

**A prediction this corrected.** Next's `revalidatePath` documentation says a Server Function "updates the UI immediately (if viewing the affected
path)"; the scholarship actions revalidate `/scholarships` while the buttons also render on `/scholarships/[id]`, so the detail page looked like it would
stay stale and a fix for it was written (the action returning `creditsBalance`, `FarahActions` reporting it). The measurement says it refreshes (the
masthead pill **and** `FarahActions`' own "You have N credits" line). That change and its unit test were **withdrawn in the PR's second commit**: no
code that is not needed. The documented caveat is conservative for this app version (`next` 16.3.5, `react-dom` 19.3.0).

**Proof the tests can fail.** Tests-first commit `0667ace` on a draft PR: unit job **13 failed, 4440 passed** across exactly the four new files
(run [36843654106](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36843654106)), at assertion level (`expected undefined to be 40`,
`expected undefined to deeply equal { balanceAfter: 35 }`); the cases that pin "nothing was spent, so no balance" passed before and after.
The e2e red/green above is the unfixed-main run. The e2e could not be run locally (no database on that machine).

### Verification (all four)

**1. GitHub API** — `GET /repos/Bayo-1987/Claude-Talentrah/pulls/615`:
```
{"merged": true, "merged_at": "2026-10-01T10:48:12Z", "merge_commit_sha": "1f275f5a7d5926d1d3ccbb6dfceb071522c42e05",
 "head_sha": "825e3dc933ee366a695b4380c1e2d0a3096b963c"}
```
Merged with `--match-head-commit`. `main` moved under this PR twice (#613, then #614 the signed-out masthead); the branch was brought up to date
each time (`git diff` showed no overlap with this PR's files) and a full CI cycle ran on each head.

**2. Fresh shallow clone** (`git clone --depth 10`): HEAD `1f275f5…`, contains the merge commit. `gate.ts` has `TailoringCommitResult` and three
`return { balanceAfter … }`; `route.ts:153` `const creditsBalance = coverLetterCommit?.balanceAfter ?? tailoringCommit?.balanceAfter ?? null` and it is in the
response; `resume-builder/actions.ts:418` `return { text: rewritten, creditsBalance: balanceAfter }`; `reportCreditsBalance` in `tailor-form.tsx:139` and
`resume-editor.tsx:226`. **`src/lib/scholarships/actions.ts` has no `creditsBalance`** (withdrawn); `tests/scholarships/actions-credits-balance.test.ts`
is absent; the three new unit files and the e2e spec are present.

**3. Live production check.** Production deployment `dpl_AcxweBqis77zakxLKink5TXwf1L7`: `READY`, `target: production`, `githubCommitSha` = `1f275f5a…`, aliased to
`www.talentrah.com`, created 2026-10-01 10:48:15. Signed-out, read-only probes (the paths themselves need a session): `POST /api/tailoring` **401**, `GET /tailor` **307 → /login**,
`GET /` 200, i.e. the deployment is serving and the routes are gated as before. **The behavioural change was not probed in production**: a tailoring run or a bullet rewrite
needs a signed-in session and spends a credit (see Not covered).

**4. Full suite against merged `main`** — CI run [36851398741](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36851398741) (push, `1f275f5`):
```
Typecheck, lint, unit tests : success   Test Files 398 passed (398)   Tests 4459 passed (4459)
Playwright e2e              : success   487 passed (10.8m)         (includes the 9 credit-balance tests)
Dependency audit, Secret scan, Migration drift (production): success   (Migration numbering: skipped on push events)
```
No flake rerun was needed on this run.

### Not covered / still open
- **No live check of these two paths in production yet.** They need a signed-in session and spend a credit. One real bullet rewrite (2 credits) would show the pill drop by 2 with no reload; offered to the owner after deploy.
- The scholarship / Auto-Apply / Talent Directory refresh rests on `revalidatePath` behaviour of the current Next version; the spec would catch a change, but only in CI.
- The PR's Lighthouse check was red (the known non-required `/jobs/remote` preview-data failure, #575).

---

## Merged 2026-10-01 — PR #614, the signed-out masthead on a phone: short CTA label below 640px, 44px targets (send-488)

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#614](https://github.com/Bayo-1987/Claude-Talentrah/pull/614) | `feat/masthead-mobile-fit-488` | 2026-10-01 10:22:10 | `8dd9ee0658a6fe8380dc3ac41c87474d05748563` |

**The bug.** On every page that renders `MarketingMasthead` (about 15 marketing pages, the legal pages, `not-found` and the signed-out app shell, so `/scholarships`,
`/jobs` and `/tracker` too), at phone widths "Log in" wrapped onto two lines and "Get started for free" onto up to four (360px: 110x120). The bar's row is a fixed 78px,
so the CTA stuck out of it. **The document did not overflow** (`scrollWidth === clientWidth` at every width), so a scrollWidth check passed on the broken layout. Root cause: the
bar had `px-10` (40px a side) on every viewport, leaving 310px of content on a 390px phone for controls that need about 398px.

**What changed** (`src/components/marketing/marketing-masthead.tsx` only; the owner picked Option B from two real renders, A = full label squeezed to 8px margins and 13px text):
- below 640px the visible CTA label is "Get started"; the link keeps `aria-label="Get started for free"` (the visible words are the start of the name, WCAG 2.5.3; the short span
  is `aria-hidden`); from 640px up the full label shows;
- Log in and the CTA are `whitespace-nowrap`; below 640px the bar's side padding is 20px and the gap 8px (`max-sm:` variants only);
- the hamburger is 44x44 (was 40x40) and the logo link has a 44px-tall hit area (`min-h-11`, no visual change).

Measured after, at 360, 375, 390 and 412px on `/`, `/about`, `/scholarships`, `/jobs`, `/tracker`: Log in 52.8x44, CTA 110.4x48, hamburger 44x44, logo link 96x44, every control on one
line, inside the bar, symmetric 20px margins. **Desktop is unchanged:** header screenshots from local production builds of `main` and of the branch are byte-identical at 1280, 1000, 900, 899, 700 and
640px on all five pages and differ only at 639px and below.

**Proof the tests can fail (red, then green).** On unchanged `main`: e2e `9 failed | 14 passed`, unit `5 failed | 3 passed`; the overflow, accessible-name, menu and desktop tests pass on `main`,
which is the scrollWidth lesson in test form. Green after: the new spec 23/23, 230/230 under `--repeat-each=10`; unit 8/8. `e2e/masthead-signed-out-mobile.spec.ts` measures what scrollWidth cannot
(visible text-node line boxes, each control against the bar's row, real hit areas at 44px for this masthead only; the repo-wide 40px floor in `hit-targets.spec.ts` is unchanged), plus the menu at 390px
(opens, the same four links pinned in order, Escape closes it with focus on the hamburger), visible keyboard focus on Log in, the CTA and the hamburger, and the 640px-and-up pins.

**The lesson from this PR's first CI run: rendered text widths are platform-dependent.** The first version of the "desktop is unchanged" pins asserted widths measured on macOS (Log in 52.8px); CI's Linux
rendered the same CSS at 55px and three tests failed (3 of 477; every other assertion passed on Linux). Pins now assert the CSS that produces the layout, which is identical everywhere: padding (Log in
6/6/10/10, CTA 30/30/15/15), font size 15, the **computed font-family stack and font-weight 600** on both controls (so a font swap cannot slip through a padding-only pin), min-height, the 78px bar, the 40px side
padding, the full label on one line. Proven able to fail: temporarily changing the ghost button's padding 6px to 7px and the base weight semibold to medium turned all three desktop tests red
(`fontWeight 600 -> 500`, `padL 6 -> 7`); reverted. A layout test must pin CSS or assert relations, never an absolute rendered width measured on one machine.

**Process.** Collision check re-run immediately before creating the branch (send-487 was taken, so 488) and again before the first push. Head history: `4537b2b` (CI red, the width pins) then the fix and a
merge of `main` (#613, no overlap) into `3f20f58`, which was merged with `--match-head-commit` after all four required checks passed on that head (0 commits behind `main`). Found while measuring and filed,
not fixed here: [#617](https://github.com/Bayo-1987/Claude-Talentrah/issues/617) (a11y, low): pressing Escape while focus is inside the open menu drops focus to `<body>` instead of the hamburger.

### Verification (all four)

**1. GitHub API** — `GET /repos/Bayo-1987/Claude-Talentrah/pulls/614`:
```
{"merged": true, "merged_at": "2026-10-01T10:22:10Z",
 "merge_commit_sha": "8dd9ee0658a6fe8380dc3ac41c87474d05748563", "state": "closed",
 "head_sha": "3f20f58f03eabe64f2a126caa1f4cbf40a3651a1", "merged_by": "Bayo-1987"}
```

**2. Fresh shallow clone** (`git clone --depth 30`, a temp dir):
```
HEAD: 8dd9ee0658a6fe8380dc3ac41c87474d05748563   (Merge pull request #614 …)
marketing-masthead.tsx: aria-label "Get started for free" present; long span (max-sm:hidden) and short span (sm:hidden, aria-hidden) present;
  logo link min-h-11; hamburger h-11 w-11; bar max-sm:px-5
PRESENT: e2e/masthead-signed-out-mobile.spec.ts (pins include fontWeight "600"), tests/marketing/marketing-masthead.test.tsx
src/lib/button-classes.ts: ghost padding px-[6px] and base font-semibold still present (the mutation used to prove the pins was reverted)
```

**3. Live production probe** (2026-10-01 10:24 UTC, **signed out**, read-only, 390px and 360px on `/`, `/jobs` and `/scholarships`). Vercel deployment `dpl_hvSWo8zeNfyZCTMceTy2dM6ANSvU`: `READY`,
`target: production`, `githubCommitSha` = `8dd9ee06…`, aliased to `www.talentrah.com`; created 10:22:14, ready 10:22:53.
```
all six page x width combinations: HTTP 200, no redirect to /login, scrollWidth == clientWidth (390 / 360), no overlapping controls, rightmost control edge 370 / 340
  logo link      96 x 44  (x=20)           hamburger  44 x 44         Log in  52.8 x 44, 1 line
  sign-up CTA   110.4 x 48, 1 line, visible text "Get started"; accessible name "Get started for free"
  inside the 78px bar: yes   every control >= 44 x 44: yes
  accessible names present once each: link "Log in", link "Get started for free", button "Main menu", link "Talentrah"
```
Identical to the local build's measurements. **Not probed live:** 375px, 412px and desktop (covered by the local byte-identical screenshots and by CI). **No signed-in production probe was done.**

**4. Full suite against merged `main`** — CI run
[36848700787](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36848700787) (push, `8dd9ee0`), `success`:
```
Typecheck, lint, unit tests : success   Test Files 395 passed (395)   Tests 4443 passed (4443)
Playwright e2e              : success   478 passed (7.5m)
Dependency audit, Secret scan: success   (Migration numbering: skipped on push events)
```
All 23 tests of the new masthead spec ran and passed, and `signed-out-link-gate.spec.ts` (`scope=ci`) passed. `Migration drift (production)`
([run 36848700801](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36848700801)): success.

### Not covered / still open
- **#617:** Escape from inside the open menu loses keyboard focus (a11y, low). The click-open path is pinned; the keyboard-inside path is not.
- **Follow-ups listed in the PR, not built:** raise the repo-wide hit-target floor from 40px to 44px (only the masthead is held to 44 here); the CTA's `px-[22px] py-[11px] text-[14px]` override is dead on desktop (the variant's classes win in `cn()`'s plain join), so the desktop CTA renders at 15px with 30px padding, and fixing it would change desktop.
- Below 640px the visible label no longer says "for free" (the full phrase is the accessible name; the homepage hero and mobile sticky bar still say it). The hamburger still sits between the logo and Log in, as before.

---

## Merged 2026-10-01 — PR #613, `/mentorship` loading placeholder carries no heading (send-487)

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#613](https://github.com/Bayo-1987/Claude-Talentrah/pull/613) | `fix/mentorship-loading-heading-487` | 2026-10-01 09:45:13 | `9152850448a01f7422b8ae600da636c061cfb34b` |

**What it changed.** One source file. `src/app/(app)/mentorship/(list)/loading.tsx` rendered the **signed-in page's** heading ("Talk to someone who's
done it.") and intro paragraph. Since send-385 a signed-out visitor reaches this route too, so the streamed loading fallback landed in the **raw HTML**
beside the page: two `<h1>`s, the wrong one first, and a slow-connection visitor reads the wrong one first (measured in send-480: 0.9 s on Fast 3G,
1.5 s on Slow 3G). It now renders eyebrow + `SkeletonStatus` + skeleton cards and **no heading**, the same neutral pattern as `/scholarships`
(send-480), `/jobs` and `/tracker` (send-484). The `Container` wrapper stays so the signed-in loading-to-page transition does not shift. No other file
changed apart from tests. No migration.

**Production before the change** (probed signed out, 2026-10-01 before the PR was pushed): `GET /mentorship` returned **2 `<h1>`s**, "Talk to someone
who's done it." at byte 4458 and the landing's "Real career mentors, for the moments Farah can't coach you through alone." at byte 96864.

**Proof the tests can fail (red, then green).** Tests-first commit `b60fd19` on a draft PR: unit job **2 failed, 4433 passed** (run
[36841854396](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36841854396)), exactly the two intended assertions in
`tests/mentorship/list-loading.test.tsx` (no heading of any level; none of the signed-in copy) and nothing else. The other three tests in that file
(still announces loading, keeps the eyebrow and skeletons, and a control that the signed-in page still carries the heading the old placeholder echoed)
passed before and after. The new e2e in `e2e/mentorship-public-landing.spec.ts` (exactly one `<h1>` in the RAW bytes via `request.get`, the landing's
own, for `/mentorship`, `?error=…` and `?utm_source=…`) could not be shown red in CI because the e2e job is skipped while the unit job fails; its
premise is the production probe above. **Not testable deterministically:** the slow-connection "wrong heading first" ordering; the raw-HTML count and
content are what the tests pin.

### Verification (all four)

**1. GitHub API** — `GET /repos/Bayo-1987/Claude-Talentrah/pulls/613`:
```
{"merged": true, "merged_at": "2026-10-01T09:45:13Z", "merge_commit_sha": "9152850448a01f7422b8ae600da636c061cfb34b",
 "head_sha": "9bca7d8d87193295f3201ed3ffa330aaecae0a74"}
```
Merged with `--match-head-commit` on that head; `main` had not moved since the PR's base.

**2. Fresh shallow clone** (`git clone --depth 10`): HEAD `9152850…`, contains the merge commit; `loading.tsx` body is `Container` > `SkeletonStatus` +
`EyebrowLabel` + `SkeletonCard`s (the only `<h1` string left in the file is inside the header comment); `tests/mentorship/list-loading.test.tsx` present;
the `send-487` e2e is in `e2e/mentorship-public-landing.spec.ts`.

**3. Live production probe** (2026-10-01 09:56 UTC, **signed out**, read-only; deployment `dpl_3ZE2yRJvy6sfjCrXfhpCZRBh7pa1`, `githubCommitSha` `91528504…`):
```
GET /mentorship                200  1 <h1>  "Real career mentors, for the moments Farah can't coach you through alone."  canonical https://www.talentrah.com/mentorship
GET /mentorship?error=anything 200  1 <h1>  same
GET /mentorship?utm_source=x   200  1 <h1>  same
signed-in heading "done it." anywhere in the response: 0      cache-control: private, no-cache, no-store, max-age=0, must-revalidate
controls: /mentorship/apply 307, /mentorship/<unknown id> 307 (the sub-paths are still gated)
```
No signed-in production probe was done; the signed-in loading-to-page transition rests on `Container` being unchanged and the existing signed-in e2e.

**4. Full suite against merged `main`** — CI on `9152850`: `Typecheck, lint, unit tests` success (394 files / 4435 tests on the PR head), `Playwright e2e`
success, `Dependency audit`, `Secret scan` and `Migration drift (production)` success. The PR's Lighthouse check was red (the known non-required
`/jobs/remote` preview-data failure, #575).

### Not covered / still open
- The placeholder keeps its `Container` wrapper (deliberately, to leave the signed-in transition alone). Whether that wrapper's gutter stacks with the shell's on a phone, as send-480 found for the scholarships landing component, was not measured here for this page.

---

## Merged 2026-10-01 — PR #607, real signed-out landing pages at `/jobs` and `/tracker` (send-484)

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#607](https://github.com/Bayo-1987/Claude-Talentrah/pull/607) | `feat/jobs-tracker-public-landing-484` | 2026-10-01 07:40:01 | `fd705e088d23167380d7b9d340abe70795df3321` |

**What it changed.** `/jobs` and `/tracker` used to 307 every signed-out visitor to `/login` (the `proxy.ts` gate). Both are now real public landing
pages, the shape `/scholarships` took in send-480. **Signed-in visitors get the feed and the tracker unchanged** (signed-in metadata is deep-equal
tested, and the e2e checks the signed-in titles and chrome). No migration.
- **Gate** (`seeker-gate-paths.ts`): `/jobs` leaves the exact-path set (now empty, deleted); `/tracker` moves from the prefix list to
  `PROTECTED_SUBPATH_ONLY_PREFIXES`, so `/tracker/[applicationId]/sent` stays gated; `/refer` stays gated. **robots.ts:** `/jobs$` removed (the last
  `$` rule), `/tracker` becomes `/tracker/`. **sitemap.ts:** `/jobs` and `/tracker` are static entries (both always answer 200).
- **/jobs:** `components/jobs/public-landing.tsx`, a presentational component. A live preview of at most six rows, shown only when the live total is at
  least `LANDING_PAGE_MIN_ENTRIES`, hidden (not apologised for) when the query fails; aggregated vs direct labelled ("sourced externally" / "Posted on
  Talentrah", the signed-in card's own wording); no match score anywhere; every card title links to its public `/jobs/<id>`. New
  `loadOpenJobsPreview` reads seven columns only: measured **1,484 B for six rows against 14,323 B** with the wide landing columns (about 9.7x), and the
  exact key set is pinned. **Not cached** (the repo has no data-cache pattern and the landing-page rule is a fresh query per call). The heading reads
  "The 6 open listings…" when every listing is shown and "A few of the 376…" when it is a sample.
- **/tracker:** `components/tracker/public-landing.tsx`, static copy, stages read from the new `TRACKER_STAGES`
  (`src/lib/tracker/stages.ts`), extracted behaviour-preservingly from `stage-filter-bar` and `tracker-card` (characterisation tests of both pass on
  main and after).
- `generateMetadata()` on both pages: signed-in metadata unchanged, signed-out gets a real title/description/canonical (bare path, no query), **no
  country claim**. Both `loading.tsx` files are neutral for both visitors with **no heading** (a streamed fallback lands in the raw HTML, so a
  heading would be a second `<h1>`).
- `liveJobLandingLinks` also returns each live `count` (additive, same single RPC). Footer: **only "Refer & Earn" changed**,
  `/refer` → `/signup?redirectTo=%2Frefer`; the footer test's RegExp matcher now escapes the href (a `?` broke it).
- Allowlist rows deleted (12 → 5 remain): `footer:* -> /jobs`, `/tracker`, `/refer`; `main:/ -> /jobs` (two sources); `main:404 -> /jobs`;
  `main:/blog/* -> /jobs`; and `main:/jobs/* -> /jobs` ("Back to jobs"). **Prompt 2 must not touch "Back to jobs"**: its row is gone only because
  `/jobs` is public now.

**A pre-existing bug this fixed: `/tracker/<missing>/sent` returned 200, not 404.** `tracker/loading.tsx` sat directly above
`tracker/[applicationId]/sent`, which calls `notFound()`; a `loading.tsx` in a route's ancestors makes Next commit to 200 before `notFound()` runs
(#221). It dates from #218 (2026-09-04) / #220 (2026-09-05) and **was live in production at `e281dc5`** until this merge. The signed-in e2e written
for this PR was **red on it** (`Expected: 404 Received: 200`, CI run [36780368340](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36780368340)),
so both files moved into a `(list)` route group, as `jobs/(feed)` and `scholarships/(list)` already do. The URL is unchanged. **Not probed in
production** (that needs a signed-in session); the evidence is the file layout and the red-then-green CI.

**Proof the tests can fail (red, then green).** Tests-first commit `96930f7` on a draft PR: CI red, unit job **15 test files failed, 370 passed**
(run [36778911877](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36778911877)), with `tsc` passing so the tests actually ran and failed on
their own assertions (a helper, `tests/support/load-module.ts`, lets tests for not-yet-existing modules typecheck). The characterisation tests
(signed-in metadata, both components' stage lists) were green before and after. Implementation commit `f4e4f90`: unit green. e2e then went red on **three runs: one real failure and three test mistakes of mine, each fixed in
the test, none by loosening it**: (1) the tracker 404 above (real, fixed in the app); (2) a footer-link assertion with a case-sensitive `/Jobs/` against
"Open jobs"; (3) a guessed `/tracker` heading; (4) the card click-through waited for a *document* navigation, but a Next `<Link>` click is a soft
navigation (an RSC fetch), so it timed out at 30 s. One unit run also died starting Supabase's Docker containers ("failed to set up container
networking", run [36821079046](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36821079046)) before any test ran: runner infrastructure, cleared by
the next push. The CI-only checks (the DB-backed
`open-jobs-preview` test and the e2e specs) could not be run locally (no database on that machine).

**A footer collision with send-486 (#610), handled by the standing rule.** #610 landed first and pins the footer to its pre-change link list; this PR
deliberately re-points Refer & Earn, so that guard failed after the merge of `main`. The merge was textually clean (no conflicting hunk). As the
second PR to land, this one updated the guard: a documented `REPOINTED_SINCE` map in `tests/marketing/marketing-footer.test.tsx` carries the one
deliberate change and any other changed link still fails it. The owner was told this in the same message as the merge.

### Verification (all four)

**1. GitHub API** — `GET /repos/Bayo-1987/Claude-Talentrah/pulls/607`:
```
{"merged": true, "merged_at": "2026-10-01T07:40:01Z", "merge_commit_sha": "fd705e088d23167380d7b9d340abe70795df3321",
 "state": "closed", "head_sha": "40f3bb332f22bf4174c8ac4fd0c169c1969efb6d", "merged_by": "Bayo-1987"}
```
Merged with `--match-head-commit` on that head. Main moved under this PR three times (#604 fonts, #610 footer, #611 docs); the branch was brought up to
date each time (`5638fec`, `0d52bb1` by a local merge of #610, `40f3bb3`), with `git merge-tree` clean before each and a full CI cycle after.

**2. Fresh shallow clone** (`git clone --depth 30`, a temp dir):
```
HEAD: fd705e088d23167380d7b9d340abe70795df3321   contains fd705e0: yes
PRESENT: components/jobs/public-landing.tsx, components/tracker/public-landing.tsx, lib/tracker/stages.ts,
         app/(app)/tracker/(list)/page.tsx, app/(app)/tracker/(list)/loading.tsx, both new e2e specs
GONE:    app/(app)/tracker/page.tsx, app/(app)/tracker/loading.tsx (old paths)
seeker-gate-paths.ts:81  PROTECTED_SUBPATH_ONLY_PREFIXES = ["/mentorship", "/employer", "/tracker"]   (no PROTECTED_EXACT_PATHS)
robots.ts:50 "/tracker/"   (no "/jobs$")   sitemap.ts:89-90 /jobs, /tracker   marketing-footer.tsx:66 href "/signup?redirectTo=%2Frefer"
```

**3. Live production probe** (2026-10-01 07:41 UTC, **signed out**, read-only). Production deployment `dpl_61ciZhQ5g7T7P76FPq1rzViybPH9`: `READY`,
`target: production`, `githubCommitSha` = `fd705e08…`, created 07:40:05.
```
GET /jobs                              200  one <h1>  canonical https://www.talentrah.com/jobs
GET /tracker                           200  one <h1>  canonical https://www.talentrah.com/tracker
GET /jobs?tab=saved&q=engineer         200  one <h1>  canonical https://www.talentrah.com/jobs         (query collapsed)
GET /tracker?stage=offer&sort=oldest   200  one <h1>  canonical https://www.talentrah.com/tracker      (query collapsed)
GET /scholarships (control)            200  one <h1>
all five: cache-control: private, no-cache, no-store, max-age=0, must-revalidate   x-vercel-cache: MISS   no x-nextjs-prerender   no set-cookie
/jobs content: "A few of the 376 open listings from the last 30 days", 6 cards, "Browse by" with live counts, 0 × "Remote · Remote";
               first card link /jobs/0a7cf7a9-… → 200 (no redirect)
robots.txt: no "Disallow: /jobs" or "/jobs$" or bare "/tracker"; "Disallow: /tracker/" and "Disallow: /refer" present
sitemap.xml (fresh): lists /jobs, /tracker (and /scholarships)
footer "Refer & Earn" on / and /about: href="/signup?redirectTo=%2Frefer"
controls: /refer, /settings, /billing, /tracker/<id>/sent  each 307 → /login?redirectTo=…   /jobs/<unknown id> 404
```
**No signed-in production probe was done.** Signed-in behaviour rests on e2e tests in CI and the metadata deep-equal unit test.

**4. Full suite against merged `main`** — CI run [36831648443](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36831648443) (push, `fd705e0`):
```
Typecheck, lint, unit tests : success   Test Files 393 passed (393)   Tests 4430 passed (4430)
Playwright e2e              : attempt 1 FAILED (1 failed, 453 passed), attempt 2 success (454 passed, 8.7m), see below
Dependency audit, Secret scan, Migration drift (production): success   (Migration numbering: skipped on push events)
```
**Attempt 1 failed on `e2e/employer-new-job-banner.spec.ts:76` ("Crop your banner" dialog not found), the known banner-spec flake tracked in
[#591](https://github.com/Bayo-1987/Claude-Talentrah/issues/591); an employer spec this change does not touch, and 453 other tests passed, including both new landing
specs.** One `--failed` rerun (job [110276205725](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36831648443/job/110276205725)) passed all 454 at
08:14:17Z. No new evidence was added to #591.

### Not covered / still open
- **Lighthouse CI is red on this PR** (not required): it requests `/jobs/remote`, which 404s on a CI-project-backed preview with fewer than 5 remote postings (the known thin-preview-data issue, #575).
- **The preview's data is the CI project's**, so the owner's screenshots showed 6 fixture listings, not production's 376 (378 when first measured).
- **The round button on the right edge in the preview screenshots is Vercel's preview toolbar** (`vercel-live-feedback`); production HTML has no reference to it.
- Follow-ups listed in the PR, not built: **`StageSelect` has a third private copy of the stage list** (pinned to `TRACKER_STAGES` by a drift test); **the signed-out masthead is cramped at 390px** on every page (pre-existing, shared with `/scholarships`); `mentorship/(list)/loading.tsx` still has the duplicate-heading-while-loading leak.

---

## Merged 2026-10-01 — PR #610, footer: Compare column removed, Legal & Trust in the top row, /vs pages linked from the comparison post (send-486)

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#610](https://github.com/Bayo-1987/Claude-Talentrah/pull/610) | `chore/footer-compare-removal-486` | 2026-10-01 06:23:07 | `fd08c9ba6ed46168e9f313c0cce888934184f627` |

**What it changed (the owner's request).** Two source files; the rest is tests.
- `src/components/marketing/marketing-footer.tsx`: the **Compare** column (heading, "Jobright Alternative", "vs. FreshTalent JobCopilot") is
  removed. The footer is now **Product | For Employers | Company & Support | Legal & Trust**. No grid change was needed: five columns in a
  four-column grid (`grid-cols-2`, `min-[901px]:grid-cols-4`) had wrapped Legal & Trust **under Product** on desktop (measured: its heading at
  y=5926 against the others at y=5546) and, at 390px, left it alone in the last row beside an empty cell; four columns are one row on desktop and
  an even 2x2 block on a phone. No other label, href, tagline, community/social row or copyright line changed.
- `src/lib/blog/related-links.ts`: the `ai-job-search-tools-nigeria-africa` list gains `/vs/jobright` ("Talentrah vs Jobright, side by side") and
  `/vs/jobcopilot` ("Talentrah vs FreshTalent JobCopilot, side by side") **ahead of** its two existing links (`/ai-resume-tailoring`,
  `/mentorship`, same order). A code change; the post's body in the database was not touched.
- The `/vs` pages are untouched: still live, still in the sitemap, still linking to each other. `MarketingFooter` is the only footer component
  (about 20 pages, the legal pages and the signed-out app shell render it; signed-in pages render none).
- **Every internal link to a `/vs` page, checked:** the footer (removed here), the two pages to each other, `sitemap.ts`, their own tests, and the blog
  related links (added here). **Production blog bodies (read-only, all 13 posts): none contains `/vs`** (control query matched 1 post with
  `/how-auto-apply-works` and 6 with any internal markdown link). No `llms.txt` or `ai.txt` exists.

**Proof the tests can fail (red, then green).** Local, no database, on the unchanged footer: unit `5 failed | 11 passed` (2 related links vs 4; Compare
heading present; 5 columns vs 4; 18 footer links vs 16), e2e `6 failed | 13 passed`. Green after: unit 33 passed (footer, related-links, the signed-out
link ratchet), e2e 18 passed with one local-only failure (an unchanged test that hardcodes the production hostname; it passes in CI), and the new layout spec
40/40 under `--repeat-each=10`. The regression guard is `SNAPSHOT_BEFORE`, the 18 (heading, label, href) rows as they stood on `main`; the footer must equal it minus
the two Compare rows, in order. Mutation-checked: dropping the Blog link turns it red. **No test was deleted:** the old Compare-column unit and e2e assertions
were rewritten to assert the column is gone; `gated-link-ratchet.test.tsx` and `signed-out-link-gate.spec.ts` are unchanged and green. New:
`tests/blog/related-links.test.ts` (pins all 11 slugs' lists) and `e2e/footer-layout.spec.ts` (one row at 1280px; a 2x2 block with no overflow at 390px).

**Process.** The task was first numbered send-484 from a collision check taken about 20 minutes earlier; #607 (send-484) and #609 (send-485) were opened in the gap, so
the branch and commits were renamed to send-486 before the first push. **Standing rule since:** the full collision check (open PRs with every send number,
remote branches, worktrees) is re-run immediately before creating a branch and again before the first push. #607 edits the same two footer files and is still open;
whichever lands second updates, and a real conflict stops the work. `update-branch` was run twice (to `00778c3` after #609, to `8cdc4a9` after #604's self-hosted fonts);
each head had a fresh green CI run, and the merge used `--match-head-commit` with the head read at merge time, 0 commits behind `main`.

### Verification (all four)

**1. GitHub API** — `GET /repos/Bayo-1987/Claude-Talentrah/pulls/610`:
```
{"merged": true, "merged_at": "2026-10-01T06:23:07Z",
 "merge_commit_sha": "fd08c9ba6ed46168e9f313c0cce888934184f627", "state": "closed",
 "head_sha": "8cdc4a9a6c51332a51b871593768e9e04565685c", "merged_by": "Bayo-1987"}
```

**2. Fresh shallow clone** (`git clone --depth 30`, a temp dir):
```
HEAD: fd08c9ba6ed46168e9f313c0cce888934184f627   (Merge pull request #610 …)
marketing-footer.tsx: 'heading: "Compare"' count 0; no "/vs/" href in code; column headings in source order: Product, For Employers, Company & Support, Legal & Trust
related-links.ts: ai-job-search-tools-nigeria-africa = /vs/jobright, /vs/jobcopilot, /ai-resume-tailoring, /mentorship
PRESENT: tests/blog/related-links.test.ts, e2e/footer-layout.spec.ts
```

**3. Live production probe** (2026-10-01 06:24 UTC, **signed out**, read-only). Vercel deployment `dpl_4oYjUSSUHooVp6tgKdEBAxyMcfQZ`: `READY`, `target: production`,
`githubCommitSha` = `fd08c9ba…`, aliased to `www.talentrah.com`; created 06:23:10, ready 06:23:48 (3 s after the merge).
```
footer on /, /about, /scholarships, /blog (all 200):
  headings: Product, For Employers, Company & Support, Legal & Trust   links: 16   "/vs" links in the footer: 0   ">Compare<" occurrences: 0
  grid class includes min-[901px]:grid-cols-4   Legal & Trust links (4th column): /legal/privacy, /legal/terms, /legal/data-cookie-notice
GET /blog/ai-job-search-tools-nigeria-africa   200   x-vercel-cache: PRERENDER, age 0   "Continue on Talentrah" present; links in order:
  /vs/jobright "Talentrah vs Jobright, side by side", /vs/jobcopilot "Talentrah vs FreshTalent JobCopilot, side by side",
  /ai-resume-tailoring "Try the AI resume tailoring", /mentorship "Browse mentors on Talentrah"
/vs/jobright 200, /vs/jobcopilot 200, both in sitemap.xml
```
The blog page is ISR (`revalidate = 3600`) and has served stale content before, so the two new links appearing at once was checked, not assumed: the new
deployment prerendered it fresh. Nothing was force-revalidated. **The footer is not rendered for signed-in users, so there is no signed-in surface to probe.**

**4. Full suite against merged `main`** — CI run
[36824491005](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36824491005) (push, `fd08c9b`), `success`:
```
Typecheck, lint, unit tests : success   Test Files 383 passed (383)   Tests 4348 passed (4348)
Playwright e2e              : success   422 passed (9.5m)
Dependency audit, Secret scan: success   (Migration numbering: skipped on push events)
```
The footer-layout spec (4 tests), the rewritten comparison-pages test and `signed-out-link-gate.spec.ts` (`scope=ci`) all ran and passed.
`Migration drift (production)` ([run 36824490964](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36824490964)): success.

### Not covered / still open
- **SEO trade-off, the owner's call:** the footer was the two `/vs` pages' only sitewide internal link. They are now linked from each other, the comparison blog post and the sitemap only; no ranking effect has been measured.
- #607 (`/jobs` and `/tracker` landing pages, still an open draft) also edits `marketing-footer.tsx` (the Refer & Earn href) and its test; a footer conflict when it updates is expected to be small but was not tested.
- The footer's 390px layout leaves white space under "For Employers" (the tall Product column beside a one-link column); unchanged from before.

---

## Merged 2026-09-30 — PR #609, the masthead credit balance updates after a paid Farah message; one success log line per Farah call (send-485, issue #605)

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#609](https://github.com/Bayo-1987/Claude-Talentrah/pull/609) | `fix/farah-balance-and-call-log-485-v2` | 2026-09-30 22:21:44 | `e281dc50b2b92f66290528fcd7c0bb0fbefca329` |

**Replaces #608**, closed unmerged: its secret-scan check failed because two *test constants were named* `SECRET` / `SECRET_REPLY` (the repo's
`talentrah-hardcoded-credential` rule keys on the variable name; the values were fake markers). Renamed on a clean branch rather than force-pushing;
#608's branch was then deleted. Issue [#605](https://github.com/Bayo-1987/Claude-Talentrah/issues/605) (low severity; the label `severity: low` was created for it).

**What it changed.** Two commits, no migration, **charging logic unchanged**.
- **(a)** After a credit-paid Farah message the masthead kept showing the pre-charge balance until the next navigation (the ledger and
  `profiles.credits_balance` were already right; display only). The chat stream's `done` event now carries `creditsBalance`: the **ledger's own
  `balance_after`** for a paid message (`spendCredits` already returned it; `commitFarahChatAllowance` now passes it on, never recomputed from the
  check-time balance), `null` for a free or Pass-covered one, and also on the `persisted: false` `done`. The panel reports it; the masthead shows it in
  place of the page-load value with no reload (`src/components/app-shell/credits-balance.tsx`). A reported value carries the server value it was
  reported against and **expires as soon as the server hands down a different number**, so a stale client value cannot outlive fresher server truth.
- **(b)** One structured success log line per Farah call (`askFarah`, `askFarahChat`, `askFarahChatStream`), `console.info` of one JSON object:
  `{"event":"farah_call","provider","model","latency_ms","failover","request_id"}`. `provider` is the one that **served** the reply (the fallback's name
  after a failover); `latency_ms` is the whole call, and for a stream the whole reply; `request_id` is a fresh UUID. No message, reply, system prompt,
  user id or email can appear (five scalars). `generateWithFailover` / `generateChatStreamWithFailover` gained an optional `onServed` callback.

**Proof the tests can fail.** On the old code 10 of the new tests failed at assertion level (`expected undefined to be 40`, `expected undefined to
deeply equal { balanceAfter: 35 }`, no `farah_call` line). A mutation that recomputes the balance instead of using the ledger's was caught; three
mutations of the log line (an extra key, a stray `console.info` echoing the message, a wrong failover flag) were each caught. The "41 → 40 without a
reload" and "free leaves it" checks are **Playwright, not component tests**: this repo has no DOM test tooling (no jsdom/testing-library). They passed
in CI; they could not be run locally (no database).

### Verification (all four)

**1. GitHub API** — `pulls/609`: `merged: true`, `merged_at` 2026-09-30T22:21:44Z, `merge_commit_sha` `e281dc50b2b92f66290528fcd7c0bb0fbefca329`,
head `ba320ecd64044b8f57ee4152816e3efff969fd7c`, 0 commits behind `main`.

**2. Fresh shallow clone** of `main` at `e281dc5`: `creditsBalance` in 13 source files, `balanceAfter` in 4, `farah_call` in `src/lib/farah/call-log.ts`,
`useDisplayedCreditsBalance` in 2; `route.ts:279` `const creditsBalance = committed?.balanceAfter ?? null` and on both `done` events; no `SECRET` constant
in `tests/farah/call-log.test.ts`.

**3. Live production check**, read-only (2026-10-01), against one **real paid message** the owner sent after the deploy. The owner saw the masthead go
**40 → 39 by itself, with no reload** (not independently observed by me). From production:
```
credit_gate_events  2026-10-01 05:27:27.715  outcome proceeded  credits_required 1  credits_available 40
credit_ledger       2026-10-01 05:27:28.391  delta -1  balance_after 39  reason farah_chat_message     (the only farah_chat_message row 22:22Z–05:28Z)
farah_messages      05:27:28.46 (farah)  05:27:28.47 (user)
=> exactly one gate event and one ledger row: exactly one charge.
Vercel runtime log, POST /api/farah/chat 200, dpl_CWdnc1Y9bqtUXFiRWhX5xdKFNPHB (githubCommitSha e281dc50…, READY, target production):
  {"event":"farah_call","provider":"groq","model":"openai/gpt-oss-120b","latency_ms":472,"failover":false,"request_id":"ef396f02-f99a-4232-b74b-e198ac94b6f6"}
```
No message text, user id or email appears in that line or in any other line in that window (the rest are page GETs with no console output). The
account then sent a second paid message at 05:31:53Z (one more −1, balance 38, its own `farah_call` line, `latency_ms` 2234), also exactly one charge.

**4. Full suite against merged `main`** — CI on `e281dc5`: `Typecheck, lint, unit tests` success (22:28:54Z, run
[36785124605](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36785124605)), `Playwright e2e` success (22:40:58Z), `Dependency audit`, `Secret scan`
and `Migration drift (production)` success. The PR's own Lighthouse check was red (the same `/jobs/remote` preview-data cause as above; not required).

### Not covered / still open
- **The same staleness likely exists on other credit-spending paths**: audited read-only in an [issue #605 comment](https://github.com/Bayo-1987/Claude-Talentrah/issues/605#issuecomment-5925475957).
  **Likely stale** by the code: tailoring / cover letter (`tailor-form.tsx` is a plain `fetch`, no refresh) and bullet rewrite. **Refreshes**: template unlock
  (`router.refresh()`). **Mechanism present but unmeasured**: the two scholarship actions, Auto-Apply confirm and the Talent Directory actions
  (`revalidatePath`). No fix yet.
- The log line's latency for a stream is the whole reply, not time to first token.

---

## Merged 2026-09-30 — PR #595, a real signed-out landing page at `/scholarships` (send-480)

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#595](https://github.com/Bayo-1987/Claude-Talentrah/pull/595) | `feat/scholarships-public-landing-480` | 2026-09-30 20:54:09 | `28ed666593e53c20bb19f8c7ee56de4938da7c97` |

**What it changed.** `/scholarships` used to 307 every signed-out visitor to `/login` (the `proxy.ts` gate, before any page
ran), so the footer link, the homepage shortcut and search all hit a login wall. It is now a real public landing page, the
same shape send-385 gave `/mentorship`. **Signed-in visitors get the catalog unchanged.** No migration. 27 files.
- `src/lib/auth/seeker-gate-paths.ts`: `PROTECTED_EXACT_PATHS` went from `{"/jobs", "/scholarships"}` to `{"/jobs"}`. That is the only code
  change in the file (the rest is comments); `PROTECTED_SUBPATH_ONLY_PREFIXES` is unchanged (`["/mentorship", "/employer"]`). Nothing
  under `/scholarships/` was ever gated (`[id]`, `apply-now`, `fully-funded`, `degree/[level]` were already public).
- `src/app/robots.ts`: the `/scholarships$` disallow is removed. `src/app/sitemap.ts`: `/scholarships` is a static entry.
- `src/app/(app)/scholarships/(list)/page.tsx`: `generateMetadata` plus a signed-out branch **above** the untouched signed-in body. Signed-in
  metadata deep-equals `{ title: "Scholarships — Talentrah" }` (pinned). New `components/scholarships/public-landing.tsx` (presentational, no
  DB access). `(list)/loading.tsx` is now neutral for both visitors, with **no heading**: a streamed loading fallback lands in the raw HTML
  beside the page, so a placeholder `<h1>` would make two in the response a crawler reads. This also fixed a bug the signed-in list had (its old
  fallback carried its own `<h1>`), which `/mentorship` still has (follow-up below).
- Footer **Scholarships → `/scholarships`** in the same change (so it can never lead the un-gating); the three `scholarships-landing` rows
  were deleted from the signed-out link allowlist (12 rows remain); `legal/terms` got `id="scholarship-listings"` so the page can link to it;
  `docs/scholarship-sources.md` lost the one sentence saying the list stayed behind a session.
- Plumbing: `liveScholarshipLandingLinks` also returns each live `count` (additive, same single RPC, same `>= LANDING_PAGE_MIN_ENTRIES` rule).
  New `loadOpenScholarshipsPreview` (verified, still open, nearest deadline first, nine columns only, never the moderation trail; **not cached**).
- Rules the PR states and pins by test: **the clock** is the server's local date, which is UTC on Vercel (a deadline of 2 Oct shows "closes today" at
  23:30 UTC on 2 Oct and is gone at 00:30 UTC on 3 Oct; shifting "today" by a day fails 7 tests); **canonical** is exactly `/scholarships`,
  no query string, so every `?level=…` variant collapses into one URL; **dynamic, never cached**: `ƒ` Dynamic because `cookies()` in
  `createClient()` (`src/lib/supabase/server.ts:11`) via `getOptionalUser()`; live response `cache-control: private, no-cache, no-store`.
- **The deadline-note guard is a heuristic.** `deadline_note` is an unbounded `text` column. The landing shows a note only if it is ≤ 140
  characters, otherwise "See the official listing for the deadline". It catches long reviewer prose, not a short one (see the Arizona entry below, #594).

**Proof the tests can fail (red, then green).** Local, no database: red on current code `45 failed | 35 passed`, green `80 passed`.
CI red on the draft PR's first commit (run [36724761670](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36724761670)): tsc and lint
passed, the unit job failed 10 files / 50 tests. e2e red on a throwaway branch (`tmp/send-480-e2e-red`, since deleted; run
[36724805150](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36724805150)): **16 failed, 398 passed**, every failure on an intended
assertion (`Expected: 200, Received: 307`; `page.url()` contains `/login`; `h2#scholarship-listings` not found; `Disallow: /scholarships$` still in
robots), no pool or auth errors. Guards proven able to fail with temporary source edits (footer before un-gating, allowlist left alone, a wildcard
`/*?ref=` rule), all reverted. A hidden pinned test was found and updated deliberately, not deleted: `tests/seo/robots.test.ts` (its
`requireUser(` scan) and `e2e/public-scholarship-page.spec.ts`. No test was removed: 5 removed lines, all renames or replacements; 93 added.

**A race in this PR's own e2e, found by CI and fixed before merge.** Head `9b58595` failed Playwright on
`scholarships-public-landing-data.spec.ts:54`: the page text it read was the loading skeleton ("Loading scholarships…"). It read
`body.innerText()` right after `goto()`, which resolves on `load`; React holds a Suspense reveal until its stylesheets arrive, which can be after
`load`. It had passed four earlier heads (about one run in five). Reproduced deliberately with a scratch harness (not committed): the old pattern
failed 2/10 with no delay and **10/10 with CSS delayed 1.5 s**; the auto-retrying pattern passed 10/10 both ways. Fixed in `cb82da4` (test-only):
every read of the page in the two new specs waits for the skeleton to be gone and the real `<h1>` to be there; `innerText`/`title()`/`count()`
snapshots became auto-retrying assertions; every negative assertion ("the pending row is absent") now follows a positive control. The real
signed-out spec then passed **170/170 (17 tests × 10), with and without the 1.5 s CSS delay** against a local production build and a read-only
stub. **Not run locally:** the data spec (needs Supabase fixtures; no database and no Docker on that machine), so its fix rests on CI and the
scratch reproduction.

### Verification (all four)

**1. GitHub API** — `GET /repos/Bayo-1987/Claude-Talentrah/pulls/595`:
```
{"merged": true, "merged_at": "2026-09-30T20:54:09Z",
 "merge_commit_sha": "28ed666593e53c20bb19f8c7ee56de4938da7c97", "state": "closed",
 "head_sha": "6e166a30a54ebbdb3951e4e783a3ff7f1e8697a5", "merged_by": "Bayo-1987"}
```
Merge commit, `--match-head-commit` given the PR's own `headRefOid` read at merge time, branch 0 commits behind `main`, marked ready a moment
before. Main kept moving under this PR, and required checks are strict, so `update-branch` was run **six times** (to `493a7d6`, `f4f4451`,
`d990e54`, `3075b06`, `9b58595`, `6e166a3`), each followed by a fresh CI run; every incoming change was checked with `git merge-tree` (clean)
and against this PR's file list (never overlapping). One green cycle (`3075b06`) was outrun by another merge (#601, docs only) before it could land. Two flakes got one rerun each, per head: a `test-user-pool.test.ts` pool-drain failure (#593 class)
on `f4f4451`, and the Google-Fonts/Turbopack `Build app` failure (#585) on `d990e54`. Both passed on rerun.

**2. Fresh shallow clone** (`git clone --depth 30`, a temp dir):
```
HEAD: 28ed666593e53c20bb19f8c7ee56de4938da7c97   (Merge pull request #595 …)
PRESENT: src/components/scholarships/public-landing.tsx, e2e/scholarships-public-landing.spec.ts, e2e/scholarships-public-landing-data.spec.ts
seeker-gate-paths.ts:31  const PROTECTED_EXACT_PATHS = new Set(["/jobs"]);
robots.ts: no '/scholarships$' disallow   sitemap.ts:81 { path: "/scholarships", … }   marketing-footer.tsx:61 href "/scholarships"
legal/terms: <h2 id="scholarship-listings">   landing spec: pageSettled() helper present (5 uses)
```

**3. Live production probe** (2026-09-30 20:57 UTC, **signed out**, read-only). Vercel deployment `dpl_F8HZv7uw1tDMEmZMGQU1XswG8MQ3`: `READY`,
`target: production`, `githubCommitSha` = `28ed6665…`, aliased to `www.talentrah.com`; created 20:54:13, ready 20:55:01 (4 s after the merge).
```
GET /scholarships                 200   one <h1>   canonical https://www.talentrah.com/scholarships
                                        title "Scholarships for Nigerian & African Students — Talentrah"
                                        cache-control: private, no-cache, no-store, max-age=0, must-revalidate   x-vercel-cache: MISS   no set-cookie
GET /scholarships?level=phd       200   one <h1>   canonical unchanged (no query)
footer href on /  and on /about   "/scholarships"
robots.txt                        no "Disallow: /scholarships" line; control "Disallow: /jobs$" present
sitemap.xml (fresh, MISS)         lists https://www.talentrah.com/scholarships; the Arizona id is absent (see the entry below)
controls: /jobs 307→/login, /tracker 307→/login, /scholarships/apply-now 200, /mentorship 200; Arizona detail page 404
```
The landing renders four real rows (e.g. "Trudeau Foundation Doctoral Scholarship — 2 Oct 2026 · 2 days left").
**No signed-in production probe was done.** Signed-in behaviour is covered by two e2e tests in CI and the metadata deep-equal unit test, not by a
production check.

**4. Full suite against merged `main`** — CI run
[36775853122](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36775853122) (push, `28ed666`), `success`:
```
Typecheck, lint, unit tests : success   Test Files 375 passed (375)   Tests 4264 passed (4264)
Playwright e2e              : success   415 passed (9.5m)
Dependency audit, Secret scan: success   (Migration numbering: skipped on push events)
```
23 tests from the two new landing specs ran and passed, and `signed-out-link-gate.spec.ts` (`scope=ci`) passed with the three allowlist rows deleted.
`Migration drift (production)` ([run 36775853105](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36775853105)): success.
(The push run for the previous main commit, `b75bc82` / #602, failed Playwright at the **Build app** step on the same Google-Fonts/Turbopack flake; not this PR.)

### Not covered / still open
- **Lighthouse CI is red on this PR's preview** (not a required check): it requests `/jobs/remote`, which 404s on a preview database with fewer than 5 open remote postings (the known thin-preview-data issue in CLAUDE.md).
- **The preview's database has no scholarships**, so the preview showed the empty state. The error state was rendered only locally (stub returning 500); the populated state is proven by the production probe above.
- **Deadlines are dates with no time zone and the rule is server UTC** (owner to decide separately): a listing closing "2 Oct" disappears at 00:00 UTC on 3 Oct, which is 17:00 on 2 Oct in California, before the provider's own cut-off, which is often in the provider's time zone. Pinned by tests so a change is deliberate.
- Follow-ups listed in the PR, not built: `mentorship/(list)/loading.tsx` still has the duplicate-heading-while-loading leak; the shared signed-out masthead is cramped at 390px on every page; `formatDeadline` uses the server locale so `10/2/2026` is ambiguous on `/scholarships/[id]`, the fully-funded and degree pages and the signed-in card; `/scholarships/apply-now`'s signed-out CTA and `/legal/terms` ("we re-check listings daily") carry slightly stale or unscoped wording.
- #594 (reviewer text can be saved into the public `deadline_note` column) stays open; the one affected row was unpublished separately (next entry).

---

## Operational 2026-09-30 — production scholarship row `b78fa6f6-…` unpublished (database change, #594, found during send-480)

| What | Where | When (UTC) | Row |
|------|-------|------------|-----|
| one guarded `UPDATE public.scholarships SET moderation_status = 'pending'` | production (`nytwbbzfpytctjsoczzq`), via the Supabase connector | about 18:13 on 2026-09-30, after the owner's explicit yes for exactly this one write | `id b78fa6f6-85d4-496a-9b60-d950abf7f416` ("2027 Innovation and Technology Scholarship (Mastercard Foundation Scholars Program at ASU)") |

**Why.** The row was `verified` with no `application_deadline` and a **698-character `deadline_note` holding internal reviewer instructions**
(the column has no length limit and nothing separates internal from public text). That text was already public on its own detail page and in
`sitemap.xml` before #595, so this was a production fix, not only a merge blocker: #595's landing would have shown "See the official listing for
the deadline" for it (the ≤ 140-character guard), but the detail page still printed the note.

**Checked before writing (read-only).** No triggers, publications, rules, `pg_net` or `pg_cron` on `public.scholarships`; the only functions
mentioning the status are `admin_moderate_scholarship` and `scholarship_landing_facet_counts`; **0** rows in `scholarship_saves` for it and 0
reminders sent (the deadline-reminder sender also skips anything not `verified`), so nothing could notify anyone; the row is not in the repo's
seed/`sources.config.ts`, so the nightly ingest cannot re-publish it.

```sql
update public.scholarships set moderation_status = 'pending'
 where id = 'b78fa6f6-85d4-496a-9b60-d950abf7f416' and moderation_status = 'verified'
returning id, moderation_status, application_deadline, length(deadline_note) as deadline_note_len,
          moderation_note, moderated_at, moderated_by;
```
A primary-key match, so it can change at most one row. It returned exactly one: `moderation_status = pending`; `deadline_note` still 698
characters; `moderation_note` null; `application_deadline` null; `moderated_at` (`2026-09-09 09:02:53+00`) and `moderated_by` unchanged. Nothing else was written.

### Verification (the four, adapted: no repo change, so no merge)
1. **The database's own answer:** the `RETURNING` row above.
2. **Repo / fresh clone:** not applicable; the SQL above is the durable record.
3. **Live probe:** at 18:14:18 UTC the detail page returned **404** signed out and the id was absent from a freshly generated `sitemap.xml`
   (`x-vercel-cache: MISS`). Re-checked at 20:57 UTC on the post-merge production deployment: detail page 404, id absent.
4. **Full suite:** not applicable (no code).

### Not covered / still open
- The row now sits in the admin pending-review queue. **It has not been fixed and re-verified**: someone has to move the reviewer text out of `deadline_note` and re-verify it (or leave it pending).
- **#594 stays open:** nothing stops reviewer text being saved into the public `deadline_note` column, and the landing's 140-character guard does not catch a short one.
- The pre-change status is recoverable only from this record (`verified`); there is no row-history table.

---

## Merged 2026-09-30 — PR #598, regression test for DOCX resume text extraction (send-481)

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#598](https://github.com/Bayo-1987/Claude-Talentrah/pull/598) | `test/docx-extract-text-481` | 2026-09-30 17:48:27 | `322d45d7baf0f61087a66bfd498ac39416cd82ce` |

**What it added.** `extractResumeText`'s DOCX branch is one line (`mammoth.extractRawText`) and no test
ran it: nothing imported `mammoth`, `e2e/golden-path.spec.ts` excludes DOCX as binary-fixture-dependent, and
the PDF suite never touches it. So #589's mammoth 1.12.3 → 1.13.0 bump (whose changelog calls the bluebird →
native-promise swap "arguably a breaking change") was covered only by a hand-run smoke test. **Test-only; no
source file changed.**
- `tests/fixtures/resume/fictional-resume.docx` — 2,248 bytes, only invented text (a fictional person, an
  `example.com` address, a `+234 800 000 0000` number), generated by a script with a fixed zip timestamp so it is
  byte-reproducible (the generator is in the PR description; run from that text it reproduced the committed file
  byte for byte).
- `tests/resume/extract-text-docx.test.ts` — 7 tests, no database/network/env: paragraphs extract in reading
  order with a three-run paragraph rejoined and "Ọlá" intact; result is plain text not zip bytes or XML; non-DOCX
  bytes, a truncated upload and an empty buffer all **reject** with an `Error` (the contract `api/resume/parse`
  and `api/resume-builder/import` rely on to answer 422); a supported document under an unsupported mime is
  refused.

**What is and is not proven (do not over-read this).** Proven able to fail: three temporary breakages of the
DOCX branch (return `""` → 4 tests red; decode as `text/plain` → 5 red; swallow errors → 3 red), restored after
each, green again. **Not covered:** one synthetic fixture only — Word-authored documents with tables, text boxes,
footnotes or tracked changes are not exercised; only `extractResumeText`, not the upload routes or the heuristic
parser on DOCX text.

### Verification (all four)

**1. GitHub API** — `GET /repos/Bayo-1987/Claude-Talentrah/pulls/598`:
```
{"merged": true, "merged_at": "2026-09-30T17:48:27Z",
 "merge_commit_sha": "322d45d7baf0f61087a66bfd498ac39416cd82ce", "state": "closed", "base": "main",
 "head_sha": "5e5222bdb942d9b6d651767ab93deb5b5244fa4b"}
```
Merged with a merge commit, `--match-head-commit` given the PR's own `headRefOid`, read at merge time with the
branch 0 commits behind `main` (main had moved once, so `update-branch` was run and all four required checks
re-run on the new head before merging).

**2. Fresh shallow clone** (`git clone --depth 80`, a temp dir):
```
HEAD: 322d45d7baf0f61087a66bfd498ac39416cd82ce   (Merge pull request #598 …)
merge SHA is an ancestor of HEAD: YES   (2 parents)
PRESENT: tests/fixtures/resume/fictional-resume.docx (2248 bytes)
PRESENT: tests/resume/extract-text-docx.test.ts (126 lines, 7 tests)
control: a SHA that is not in the repo is rejected ("Not a valid commit name")
```

**3. Live production probe** (2026-09-30 18:24 UTC, read-only). The change is test-only, so the probe can only
show what production serves. Vercel deployment `dpl_3qvC56bwbztCKno2PXJE4215WHw3`: `READY`, `production`,
`githubCommitSha` = `322d45d7…`, and `vercel inspect https://www.talentrah.com` resolves to it. **It was created
10 min 9 s after the merge (17:58:35), not 4–5 s as for every other merge that day** — a check made a few minutes
after the merge found no deployment for this SHA and it looked like a skip; it was a delay. All 15 production
merges to `main` from 2026-09-30 00:00 UTC have a deployment, including docs-only and test-only ones, and the repo
has no `ignoreCommand` (`vercel.json`, `git grep`). The cause of the delay was not established (the Vercel project's
own Ignored Build Step setting is not readable through the API used).

**4. Full suite against merged `main`** — CI run
[36755240931](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36755240931) (push, `322d45d`), `success`:
```
Typecheck, lint, unit tests : success   Test Files 365 passed (365)   Tests 4143 passed (4143)
Playwright e2e              : success   392 passed (9.2m)
Dependency audit, Secret scan: success   (Migration numbering: skipped on push events)
✓ tests/resume/extract-text-docx.test.ts (7 tests)
```
`Migration drift (production)` also ran ([run 36755240848](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36755240848)): success.

### Not covered / still open
- The `openai` 7.15.0 → 7.23.0 bump, merged in the same PR as mammoth, had no equivalent test; PR #600 (merged 2026-09-30 18:40 UTC, `9e80518`) added one.

---

## Merged 2026-09-30 — PR #589, Dependabot `routine-updates` group: 12 dependency bumps

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#589](https://github.com/Bayo-1987/Claude-Talentrah/pull/589) | `dependabot/npm_and_yarn/routine-updates-9377616297` | 2026-09-30 16:27:31 | `cdd29d5649b136cbe0625d2a5e7e7943c581ee7d` |

**What it did.** Bumped 12 packages, all patch or minor, no majors: `@google/genai` 2.22.0→2.24.0,
`@supabase/supabase-js` 2.116.0→2.117.2, `mammoth` 1.12.3→1.13.0, `marked` 18.0.13→18.0.14, **`next` 16.3.5→16.3.6**,
`openai` 7.15.0→7.23.0, `posthog-node` 5.52.4→5.54.1, `resend` 6.28.1→6.30.0, `@next/bundle-analyzer` and
`eslint-config-next` 16.3.5→16.3.6, `lint-staged` 17.5.1→17.6.0, `tsx` 4.23.13→4.23.15. Only `package.json` and
`package-lock.json` changed.
- **`next` 16.3.6 is a security release** (release note: GHSA-vcvr-r3jv-pc5j, remote code execution in `next/og`
  `ImageResponse`). The repo uses `ImageResponse` for the job, city, country and blog share images
  (`src/lib/seo/og-card.tsx`). The advisory itself could not be read (the GitHub advisories API returned 404), so
  its severity is unconfirmed.
- Reviewed for this repo: `mammoth` 1.13.0's changelog calls its bluebird → native-promise change "arguably a
  breaking change" (our only call is `await mammoth.extractRawText({ buffer })`, `src/lib/resume/extract-text.ts`);
  `posthog-node` 5.52.6 changes local feature-flag holdout evaluation (we use PostHog for analytics only; our flags
  come from a database table); `lint-staged` 17.6.0 now stages changes made by tasks (ours is `eslint` with no
  `--fix`). The decision to merge was the founder's, on this evidence.

**What is and is not proven (do not over-read this).**
- mammoth 1.13.0 was smoke-tested by hand in a scratch directory (a real minimal `.docx` extracted correctly; bad
  input rejects). **It is now covered in CI by PR #598.**
- **`openai` 7.23.0 is our Groq client and has NOT been exercised in production.** The post-deploy window below saw
  no Farah, tailoring or other LLM request, so an empty error log says nothing about it. PR #600 (merged 2026-09-30 18:40 UTC, `9e80518`) drives the
  real package with only `fetch` mocked and shows the same 14 tests pass on 7.15.0 and 7.23.0; a real-traffic
  re-check of production logs was agreed for after the founder's own Farah request.

**How this merge actually went (recorded because it cost rework and broke a convention).** Dependabot rebased
once on request (`@dependabot rebase`; head `44daec6`, all four required checks green). Main then moved and, with
`strict: true`, I ran `gh pr update-branch` (head `23eff5d`); Playwright failed on the banner-spec flake
([#591](https://github.com/Bayo-1987/Claude-Talentrah/issues/591), run 36707738755, `:76`). I pushed an empty commit
to Dependabot's branch to retry (`0822055`), whose unit job then failed on two unrelated flakes
(`login-rate-limit.test.ts`, see PR #599; `course-catalog.test.ts` pool claim,
[#593](https://github.com/Bayo-1987/Claude-Talentrah/issues/593)). `gh run rerun --failed` (the founder's chosen
method, no new commit) then passed all four required checks on `0822055`. Main moved again, so `update-branch`
(head `71c11b9`): its `Build app` step failed on the font-fetch flake
([#585](https://github.com/Bayo-1987/Claude-Talentrah/issues/585), run 36720469297). Main moved once more, and a last
`update-branch` (head `0295fb6`) went green on run 36741776142 and was merged.
**Rule from here: do not use `update-branch` or push commits to a Dependabot branch — it stops Dependabot
rebasing that PR; comment `@dependabot rebase` and wait for its push.**

### Verification (all four)

**1. GitHub API** — `GET /repos/Bayo-1987/Claude-Talentrah/pulls/589`:
```
{"merged": true, "merged_at": "2026-09-30T16:27:31Z",
 "merge_commit_sha": "cdd29d5649b136cbe0625d2a5e7e7943c581ee7d", "state": "closed", "base": "main",
 "head_sha": "0295fb6729df3b517f526b749a7fd3f095d96e63"}
```
Merged with a merge commit, `--match-head-commit` given the PR's `headRefOid`, branch 0 commits behind `main`, the
CI run (36741776142) on exactly that head.

**2. Fresh shallow clone** (`git clone --depth 80`):
```
HEAD … merge SHA is an ancestor of HEAD: YES   (2 parents)
package.json: @google/genai ^2.24.0  @supabase/supabase-js ^2.117.2  mammoth ^1.13.0  marked ^18.0.14
              next 16.3.6  openai ^7.23.0  posthog-node ^5.54.1  resend ^6.30.0
              @next/bundle-analyzer ^16.3.6  eslint-config-next 16.3.6  lint-staged ^17.6.0  tsx ^4.23.15
package-lock.json resolved: next 16.3.6, @supabase/supabase-js 2.117.2, mammoth 1.13.0, openai 7.23.0,
                            lint-staged 17.6.0, tsx 4.23.15
```

**3. Live production probe, post-deploy** (2026-09-30 16:27–16:59 UTC). Deployment
`dpl_2eWvD8iVCBdQXZjV9ozY4ztnjX9A`: `READY`, `production`, `githubCommitSha` = `cdd29d56…`, created 16:27:34 (3 s
after the merge), aliased to `www.talentrah.com` and `talentrah.com`.
```
GET /jobs/b63fea50-…/opengraph-image-rm6pzr   200  image/png  1200x630  38,495 B  x-vercel-cache: MISS
   (freshly rendered by the new deployment = next/og ImageResponse on next 16.3.6; image viewed, renders correctly)
GET blog post OG image                         200  image/png  62,815 B
runtime errors, hour BEFORE (15:27–16:27:30): none — by three methods (error clusters; error/fatal/warning logs;
                                              5xx in two half-hour slices); ~233 requests (220x200, 8x307, 3x304, 1x404)
runtime errors, 31 min AFTER (16:27:30–16:59): none (error clusters; error-level logs; no 4xx/5xx); at least 31 requests
                                              (28x200, 3x307, plus a third status value whose count the table did not show); control: my own OG fetches visible
LLM routes requested in the after-window: NONE  (a search for "groq" returned nothing)
```

**4. Full suite against merged `main`** — CI run
[36744346072](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36744346072) (push, `cdd29d5`), overall
`failure`:
```
Typecheck, lint, unit tests : success   Test Files 364 passed (364)   Tests 4136 passed (4136)
Dependency audit, Secret scan: success   (Migration numbering: skipped on push events)
Playwright e2e              : FAILURE   391 passed, 1 failed:
   e2e/employer-new-job-banner.spec.ts:76 — getByRole('dialog', { name: 'Crop your banner' }) not found (5000ms)
```
**The run is red for one reason, the known banner-spec flake, and it is the first time it has failed on `main`**
(recorded on [#591](https://github.com/Bayo-1987/Claude-Talentrah/issues/591)). It was not re-run. The same spec
had failed on this PR's branch before the bump merged and on branches with no dependency change. `main`'s next
push (run 36755240931, PR #598) passed Playwright. `Migration drift (production)`: success
([run 36744346083](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36744346083)).

**Required checks:** `Migration numbering`, `Typecheck, lint, unit tests`, `Playwright e2e`, `Secret scan`, all
green on the merged head. **`Lighthouse CI…` failed on every Dependabot run** for a different reason than on other
branches: the "wait for the Vercel preview" step got HTTP 401 on all 300 attempts. Most likely cause (unconfirmed):
Dependabot-triggered runs get the Dependabot secret store, which is empty here, not the Actions secrets that hold
`VERCEL_AUTOMATION_BYPASS_SECRET` (recorded on [#575](https://github.com/Bayo-1987/Claude-Talentrah/issues/575)).

### Not covered / still open
- `openai` not exercised in production (above); PR #600 (merged 18:40 UTC, `9e80518`) now covers the request/response/error
  surface in CI, but production real-traffic exposure is still to be re-checked.
- Flakes seen while merging this: banner spec (#591), test-user pool (#593), font-fetch build (#585), the
  `login-rate-limit` window boundary (PR #599, merged 2026-09-30 19:01 UTC, `1020f70`).

---

## Merged 2026-09-30 — PR #590, signed-out gated-link ratchet (send-477)

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#590](https://github.com/Bayo-1987/Claude-Talentrah/pull/590) | `test/signed-out-link-gate-477` | 10:45:51 | `6cb4e26aaf27cbc57e7c9967f0fb1dfbeb39c36b` |

**What it added.** A standing regression net so a signed-out visitor is never sent to
`/login` by an internal link on a public page. Nothing user-facing changed: no page or
link was modified.
- **Refactor (no behaviour change):** `isProtectedSeekerPath` and its three path sets moved
  verbatim from `src/proxy.ts` into `src/lib/auth/seeker-gate-paths.ts`, a module with no
  imports, so tests and the crawl can ask "is this path gated?" without loading
  `next/server`. `proxy.ts` imports it; there is exactly one definition.
- **Crawl (`e2e/signed-out-link-gate.spec.ts`, in the existing Playwright job):** fetches
  every sitemap URL plus seeds the sitemap does not list (the real 404 page, `/login`,
  `/signup`, `/employer`, `/mentorship`) with no session, collects same-origin links by
  region (masthead / main / footer), and follows every distinct target hop by hop. A chain
  through `/login` or `/admin/login` is a gated link, keyed `region:page-group -> target`.
- **Ratchet:** the known offenders live in `tests/support/gated-link-allowlist.ts` (15 rows;
  14 tagged `ci`, 1 `prod-only`; each with a fixed owner: `prompt-2` x6, `prompt-3` x6,
  `scholarships-landing` x3). A new gated link fails; a row whose link is gone also fails, so
  the list can only shrink.
- **Unit companion** (`tests/marketing/gated-link-ratchet.test.tsx`): runs the real footer and
  every `RELATED_LINKS` entry through the real gate, both directions. `RELATED_LINKS` gained
  the `export` keyword, the only change to `related-links.ts`.
- **Manual production mode:** `npm run check-signed-out-links` runs the same spec against
  production (`LINK_GATE_SCOPE=all`). About 1,000 signed-out requests per run: run it rarely,
  never in a loop or on a schedule. It refuses to run when `CI` is set, and is in no workflow.

### Verification (all four, per the standard above)

**1. GitHub API** — `GET /repos/Bayo-1987/Claude-Talentrah/pulls/590`:
```
{"merged": true, "merged_at": "2026-09-30T10:45:51Z",
 "merge_commit_sha": "6cb4e26aaf27cbc57e7c9967f0fb1dfbeb39c36b", "state": "closed",
 "head_sha": "009634fb606f67f897d2abc8c28e5a3e3418d706"}
```
Merged with a merge commit, `--match-head-commit` given the PR's own `headRefOid`, read at
merge time with the branch 0 commits behind `main`.

**2. Fresh shallow clone** (`git clone --depth 30`, a temp dir, not the working copy):
```
HEAD: 6cb4e26aaf27cbc57e7c9967f0fb1dfbeb39c36b   (Merge pull request #590 …)
merge SHA is an ancestor of / equal to HEAD: YES   (2 parents)
PRESENT: src/lib/auth/seeker-gate-paths.ts (93 lines)
PRESENT: e2e/signed-out-link-gate.spec.ts (196 lines)
PRESENT: tests/support/gated-link-allowlist.ts (190 lines)
PRESENT: tests/marketing/gated-link-ratchet.test.tsx (170 lines)
PRESENT: tests/scripts/link-gate.test.ts (307 lines)
proxy.ts imports the gate from the new module: 1     proxy.ts still defines the sets: 0
definitions of isProtectedSeekerPath in src: 1 (seeker-gate-paths.ts)
RELATED_LINKS exported: 1     npm script check-signed-out-links: 1
allowlist rows with an owner: 15     followUp fields left: 0
control: the module is absent at the merge commit's first parent
```

**3. Live production probe, post-merge** (2026-09-30 10:48:09 UTC, 2 min 18 s after merge; signed-out, read-only).
Vercel deployment `dpl_2bFKmGD1wxeBzzSvnLT3FCUruaxZ`: `readyState: READY`, `target: production`,
`githubCommitSha: 6cb4e26aaf27cbc57e7c9967f0fb1dfbeb39c36b`, aliased to `www.talentrah.com`
and `talentrah.com` (`aliasError: null`); created 10:45:55, ready 10:46:53.
The change is a refactor plus tests, so the probe checks that the gate behaves exactly as before:
```
GET /                        200, footer Scholarships anchor href="/scholarships/apply-now"
GET /tracker                 307 -> /login?redirectTo=%2Ftracker
GET /jobs                    307 -> /login?redirectTo=%2Fjobs
GET /scholarships            307 -> /login?redirectTo=%2Fscholarships
GET /mentorship/apply        307 -> /login?redirectTo=%2Fmentorship%2Fapply
GET /scholarships/apply-now  200, no redirect
GET /mentorship              200      GET /employer   200      GET /jobs/remote   200
GET /sitemap.xml             200, 462 URLs, lists /scholarships/apply-now
```
The repo's own **"Migration drift (production)"** workflow also ran on the merge commit
([run 36704398117](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36704398117))
and concluded `success`. The 1,000-request crawl was deliberately not repeated after merge:
the manual mode was run against production at the final pre-merge commit (see below).

**4. Full suite against merged `main`** — the CI run GitHub started on the merge commit
([run 36704397981](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36704397981),
head `6cb4e26`), concluded `success`:
```
Typecheck, lint, unit tests : success   Test Files 361 passed (361)   Tests 4089 passed (4089)
Playwright e2e              : success   392 passed (7.5m)
Dependency audit, Secret scan: success   (Migration numbering: skipped on push events)
```
The new tests ran there: `link-gate.test.ts` (31 tests), `gated-link-ratchet.test.tsx` (16),
`marketing-footer.test.tsx` (6), `seeker-app-gate.test.ts` (6), `scholarship-embed.test.ts` (5); and
the crawl spec (`✓ 368 e2e/signed-out-link-gate.spec.ts:93:5 … (8.0s)`), which reported
`http://localhost:3000  scope=ci`, 428 sources, 568 targets, 14 gated links.

### Proof it can fail (red, then green)
- **Refactor is a pure move:** the moved block is byte-identical to `origin/main`'s (79 lines);
  `proxy.ts` equals the old file minus that block plus one import line; old-vs-new gate function
  over 370 paths (205 crawled + 165 edge cases) gave 0 differences.
- **CI red** (run [36692990419](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36692990419),
  tests only, allowlist empty, stubs throwing): 2 files failed, 30 of 4076 tests failed; `tsc` and
  lint passed first. The two ratchet companions listed exactly the 4 footer and 5 blog gated links.
- **Against production, allowlist empty:** `npm run check-signed-out-links` failed with 15 NEW links
  (466 sources, 637 targets followed, 2.2 min). **With the allowlist:** `1 passed (2.2m)`, re-run at
  the final commit.
- **A bug in send-384's link pattern, pinned:** `extractLinks` returns `[]` for an anchor whose class
  contains `>` (`[&>svg]:h-4`); the new extractor finds it (`tests/scripts/link-gate.test.ts`).
- **The ratchet comparison** (`ratchetDiff`) is pure and unit-tested in both directions, including
  the `ci` versus `prod-only` scoping and that a crawl observing nothing cannot pass a non-empty list.

### What CI showed on the PR, on the merged head `009634f` (run [36701134155](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36701134155))
```
Typecheck, lint, unit tests : success   Test Files 361 passed (361)   Tests 4089 passed (4089)
Playwright e2e              : success   392 passed (9.1m)
Migration numbering, Secret scan, Dependency audit: success     Lighthouse: failure (known, #575; not required)
```
- **The crawl spec ran in CI, not vacuously:** `✓ 368 e2e/signed-out-link-gate.spec.ts:93:5 › a signed-out
  visitor is never sent to /login by an internal link on a public page (11.0s)`, report header
  `http://localhost:3000  scope=ci`, 428 sources, 568 targets, 14 gated links. Rows
  `main:/jobs/* -> /jobs` (379 pages) and `main:/scholarships/* -> /scholarships` were observed, so
  no seed data was added.
- **Time added to e2e:** the spec's own 11.0 s. The e2e job's wall-clock was 13m22s against
  `main`'s mean of 13m02s over its last 8 successful runs (range 10m48s–14m13s).
- The branch was updated with `main` three times (`aa6f8ac`, `8ca9ca0`, `009634f`) as `main` moved;
  the run on `8ca9ca0` failed only on the known `refresh-job.test.ts` flake (#577: 4083 of 4084
  tests), and `main` had moved again by the time it finished, so the branch was updated (to
  `009634f`) instead of re-running that head; the fresh run was green.

### Not covered / still open (do not read this entry as saying otherwise)
- **The 15 gated links still exist.** This PR records them; it fixes none. Owners: `prompt-2`
  (footer `/resume-builder`; homepage `/resume-builder`; `/jobs/*` back link; blog `/tailor`,
  `/resume-builder`, `/tailor?coverLetter=1`), `prompt-3` (footer `/jobs`, `/tracker`, `/refer`;
  homepage `/jobs`; the 404 page; blog `/jobs`), `scholarships-landing` (homepage, `/scholarships/*`
  and blog links to `/scholarships`).
- **Blind spots:** links that only exist after client-side state (`jd-demo-input.tsx:309`, a
  result-state `/resume-builder` link), links added by JavaScript, and public pages that are neither
  in the sitemap nor in the seeds.
- **Page groups are coarse** (`/jobs/remote` shares `/jobs/*` with detail pages): a second page of an
  already-listed kind linking to an already-listed target is not caught by the crawl.
- **One row is `prod-only`** (`main:/blog/* -> /scholarships`): the six scholarship posts exist only in
  production content, so the CI crawl cannot see it; the unit companion and the manual mode do.
- **Follow-ups, deliberately not in this PR:** `src/app/robots.ts` hand-mirrors the same gate list; the
  `marketing-footer.tsx` comment still names `proxy.ts PROTECTED_EXACT_PATHS`, which now lives in
  `seeker-gate-paths.ts`; a wildcard guard for the robots check in the footer test (a `*` rule could be
  misjudged as a prefix).
- **Lighthouse** is red on every recent PR run for an unrelated reason; tracked in issue
  [#575](https://github.com/Bayo-1987/Claude-Talentrah/issues/575).

---

## Merged 2026-09-30 — PR #588, /vs pages: sourced, dated competitor claims; "FreshTalent JobCopilot" naming (send-478)

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#588](https://github.com/Bayo-1987/Claude-Talentrah/pull/588) | `fix/vs-pages-source-check-478` | 2026-09-30 10:07:15 | `1f7f2bd198accdacbd0fa6c505f4aa34a4331906` |

**What it did.** A source check of the two comparison pages (2026-09-30) found an untested absolute claim
("doesn't work outside the US", "no workaround" — the only source tested the UK, Europe and India, never Nigeria),
a competitor price called "not published" that the competitor now publishes in naira, undated and unlinked
competitor prices, and the competitor named "JobCopilot" while a different product, jobcopilot.com, exists. Changed:
- `/vs/jobright`: H1 is now "Looking for a Jobright alternative in Nigeria? Jobright is built for the US market."
  (title unchanged, "Jobright Alternative for Nigeria & Africa — Talentrah", so the target phrase stays in both);
  dropped "well-reviewed"; third-party-reported prices ($17.99/week, $39.99/month, $89.99/quarter) carry "September
  2026", a source link, and "Jobright publishes no pricing page"; the zPlatform review and the June 2025 release are
  named and linked.
- `/vs/jobcopilot`: named "FreshTalent JobCopilot" throughout including title/metadata (URL unchanged); its Nigeria
  prices stated plainly and linked ("per its pricing page, September 2026": Basic ₦2,900/week or ₦8,000/month,
  Premium ₦7,000/₦21,000, Elite ₦9,000/₦27,000, Career Intelligence ₦21,000/year); says outright that its cheapest
  paid plan costs less than our 7-Day Pass (₦6,500); "career advisors" quoted as its page words it.
- `/ai-resume-builder`: "and dozens more" → "oil & gas and more". Footer label → "vs. FreshTalent JobCopilot".
- **Guard test** `tests/marketing/vs-pages-honest-claims.test.ts` (4 cases + a control): fails on the absolute
  phrases ("no workaround", "doesn't work", "at all", "only real"), on a competitor price with no month-year and link
  nearby, on the Jobright title/H1 losing the target phrase, and on a bare "JobCopilot". **Deliberately no test on how
  old a source date is** (it would turn red on its own and block unrelated PRs).
- A blog-post database fix to match this wording was done separately and later; see the operational entry below.

**What is and is not proven (do not over-read this).** The competitor facts were checked on 2026-09-30 against
zPlatform, OutApply and FreshTalent's own pricing page; **nothing was re-checked at handoff**, and they go stale.
**No legal review has been done** of the comparative claims, competitor names in titles/URLs, or the jobcopilot.com
vs FreshTalent naming; a quarterly re-check of every competitor fact was also recorded. Both are follow-ups in the PR
description only; nothing is scheduled.

### Verification (all four)

**1. GitHub API** — `GET /repos/Bayo-1987/Claude-Talentrah/pulls/588`:
```
{"merged": true, "merged_at": "2026-09-30T10:07:15Z",
 "merge_commit_sha": "1f7f2bd198accdacbd0fa6c505f4aa34a4331906", "state": "closed", "base": "main",
 "head_sha": "82717dd4b56dcc90d4b1ecdb8b845f2cdbba098d"}
```
Merged with a merge commit, `--match-head-commit` given the PR's `headRefOid`, after `update-branch` (main had moved;
strict protection) and a fresh CI run on the new head.

**2. Fresh shallow clone** (`git clone --depth 80`):
```
merge SHA is an ancestor of HEAD: YES   (2 parents)
PRESENT: tests/marketing/vs-pages-honest-claims.test.ts (152 lines)   src/app/vs/jobright/page.tsx (302)
         src/app/vs/jobcopilot/page.tsx (320)
jobcopilot title "Talentrah vs. FreshTalent JobCopilot": 2     "Jobright publishes no pricing page": 3 (incl. comments)
old "no workaround" in jobright page: 0      footer label "vs. FreshTalent JobCopilot": 1
old "dozens more" in ai-resume-builder: 0
```

**3. Live production probe.** Shortly after the deploy (same session; not timestamped) `/vs/jobright`, `/vs/jobcopilot`
and `/ai-resume-builder` were fetched signed-out and showed the new title, H1 and pricing text; redone 2026-09-30
18:24:18 UTC:
```
GET /vs/jobright       200  <title>Jobright Alternative for Nigeria & Africa — Talentrah</title>
   H1 "Looking for a Jobright alternative in Nigeria? Jobright is built for the US market."
   "Jobright publishes no pricing page": 1   old "no workaround": 0   old "well-reviewed": 0
GET /vs/jobcopilot     200  <title>Talentrah vs. FreshTalent JobCopilot — AI Job Search Compared</title>
   ₦2,900: 1   ₦21,000: 1   link to jobcopilot.freshtalent.africa/pricing: 1
GET /ai-resume-builder 200  "dozens more": 0   "oil &amp; gas and more": 1
```
Vercel deployment `dpl_FURQq9d1Eavs56yZAgcyNJSKwetT`: `READY`, `production`, `githubCommitSha` = `1f7f2bd1…`, created
10:07:19 (4 s after the merge), aliased to `www.talentrah.com` and `talentrah.com` when checked.

**4. Full suite against merged `main`** — CI run
[36700453221](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36700453221) (push, `1f7f2bd`), `success`:
```
Typecheck, lint, unit tests : success   Test Files 359 passed (359)   Tests 4042 passed (4042)
Playwright e2e              : success   391 passed (9.7m)
Dependency audit, Secret scan: success   (Migration numbering: skipped on push events)
```
`Migration drift (production)`: success ([run 36700453145](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36700453145)).

### Proof it can fail (red, then green)
- **Red** (run [36692580115](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36692580115), guard test only,
  old pages): cases 1–4 failed, 358 of 359 files passed. Case 3 (title/H1 pin) was a positive pin the old pages
  already satisfied, so it stayed green on the old pages by design.
- **Green:** the tip's unit, migration and secret checks, and all 16 `/vs` e2e tests, passed.

### What CI showed on the PR
`Playwright e2e` failed **twice** on `e2e/employer-new-job-banner.spec.ts` — runs
[36692988259](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36692988259) (`:203`) and
[36695260667](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36695260667) (`:76`) — and passed on the
updated head, run [36698388150](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36698388150). Tracked in
[#591](https://github.com/Bayo-1987/Claude-Talentrah/issues/591). `Lighthouse CI…` (not required) failed on the
thin-preview-dataset 404 ([#575](https://github.com/Bayo-1987/Claude-Talentrah/issues/575)).

### Not covered / still open
- Legal review of the `/vs` pages; quarterly re-check of every competitor fact (both unscheduled).

---

## Operational 2026-09-30 — production blog post `ai-job-search-tools-nigeria-africa` rewritten to match the /vs pages (database change, send-478 follow-up)

| What | Where | When (UTC) | Row |
|------|-------|------------|-----|
| one guarded `UPDATE` of `public.blog_posts.body` | production (`nytwbbzfpytctjsoczzq`), via the Supabase connector | executed 2026-09-30 09:47:23, result 09:47:27 (an `EXPLAIN` validating the statement ran at 09:01:09; nothing was written then) | `id 9a226072-885a-411b-8a6d-437956681f3c` |

**What it did.** The post made the same now-corrected claims as the /vs pages: that Jobright's site "nothing ... engages
with Nigeria", that FreshTalent's JobCopilot applies "fully automated" "up to 50 times a day", and that neither
competitor offers mentorship ("Neither Jobright nor FreshTalent offers anything equivalent"). Six exact substrings
were replaced so the post says what #588's pages now say: Jobright's US focus attributed to an independent review
(zPlatform, September 2026) and to the Jobright pages checked in September 2026; "FreshTalent JobCopilot" named
consistently with its pricing page linked and dated; its auto-apply described as up to 50 a day on the top plan
(5 and 20 on cheaper ones) with approval optional; and the mentorship line corrected (Jobright's Turbo plan is
reported to include live career-coach consultations; FreshTalent JobCopilot's Elite plan lists "AI offer negotiation
and career advisors"). Run after the founder's explicit "yes" to the dry run.

**The guard.** One atomic statement: it updates at most the one published row with that slug, only if EVERY old
snippet occurs exactly once in the body, and errors (writing nothing) unless exactly one row changed. **`updated_at`
was deliberately left alone** (only JSON-LD `dateModified` reads it; no visible "edited" label; no trigger).

```sql
-- send-478 — blog post ai-job-search-tools-nigeria-africa: match the new /vs page wording.
-- NOT RUN. Guarded, single statement (atomic): it changes at most one row, only if EVERY old snippet
-- occurs exactly once in the body, and it errors (writing nothing) unless exactly one row changed.
-- updated_at is deliberately left alone. Dry run (SELECT) results are in the PR thread: all six snippets
-- occur exactly once; result is 3,406 characters (2,899 + 507 before the sixth snippet).
with changed as (
  update public.blog_posts
     set body = replace(replace(replace(replace(replace(replace(body,
       $q$Its own job filters default to United States locations, its headline feature set includes H1B visa filtering, and nothing on the site engages with Nigeria, naira, or any African hiring market. That's not a flaw in Jobright — it was built for a different job seeker. It just means searching for African-market help and landing there won't get you very far.$q$,
       $q$An independent review ([zPlatform, September 2026](https://zplatform.ai/ai-reviews/jobright-ai/)) reports that its job search defaults to US listings and that it ships an H1B visa filter, and the Jobright pages we checked in September 2026 don't mention Nigeria or Africa. That's not a flaw in Jobright — it was built for a different job seeker. It just means it isn't designed around the Nigerian and African market.$q$),
       $q$## FreshTalent's JobCopilot: the closest local competitor$q$,
       $q$## FreshTalent JobCopilot: the closest local competitor$q$),
       $q$FreshTalent, built across 54 African countries, is the one product actually contesting this same ground — and its JobCopilot tool is a real, comprehensive AI job search suite: automated matching, tailored applications, an ATS resume checker, a resume builder, cover letter generation, and interview practice.$q$,
       $q$FreshTalent JobCopilot, which covers all 54 African countries, is the closest product contesting this same ground — a real, comprehensive AI job search suite: automated matching, tailored applications, an ATS resume checker, a resume builder, cover letter generation, and interview practice (some of it on paid plans, per [its pricing page](https://jobcopilot.freshtalent.africa/pricing), September 2026).$q$),
       $q$more about two specific things it doesn't do, and one it does differently.$q$,
       $q$more about two things it doesn't list on its public pages, and one it does differently.$q$),
       $q$JobCopilot's own pitch is applying "while you sleep," up to 50 times a day, fully automated. Talentrah's [Auto-Apply](/how-auto-apply-works) makes the opposite bet:$q$,
       $q$FreshTalent JobCopilot's own pitch is applying "while you sleep," with up to 50 applications a day on its top plan (5 and 20 on the cheaper ones), and its FAQ says you can choose to require approval before each submission. Talentrah's [Auto-Apply](/how-auto-apply-works) makes a different bet:$q$),
       $q$Neither Jobright nor FreshTalent offers anything equivalent.$q$,
       $q$As of September 2026, neither Jobright's nor FreshTalent JobCopilot's public pages describe a mentor marketplace; Jobright's Turbo plan is reported to include live career-coach consultations, and FreshTalent JobCopilot's Elite plan lists "AI offer negotiation and career advisors".$q$)
   where slug = 'ai-job-search-tools-nigeria-africa'
     and status = 'published'
     and (select bool_and((length(body) - length(replace(body, v.old, ''))) = length(v.old))
            from (values
              ($q$Its own job filters default to United States locations, its headline feature set includes H1B visa filtering, and nothing on the site engages with Nigeria, naira, or any African hiring market. That's not a flaw in Jobright — it was built for a different job seeker. It just means searching for African-market help and landing there won't get you very far.$q$),
              ($q$## FreshTalent's JobCopilot: the closest local competitor$q$),
              ($q$FreshTalent, built across 54 African countries, is the one product actually contesting this same ground — and its JobCopilot tool is a real, comprehensive AI job search suite: automated matching, tailored applications, an ATS resume checker, a resume builder, cover letter generation, and interview practice.$q$),
              ($q$more about two specific things it doesn't do, and one it does differently.$q$),
              ($q$JobCopilot's own pitch is applying "while you sleep," up to 50 times a day, fully automated. Talentrah's [Auto-Apply](/how-auto-apply-works) makes the opposite bet:$q$),
              ($q$Neither Jobright nor FreshTalent offers anything equivalent.$q$)
            ) as v(old))
  returning id, slug, updated_at, length(body) as new_len,
            position($q$fully automated$q$ in body) = 0 as fully_automated_gone,
            position($q$nothing on the site$q$ in body) = 0 as nothing_on_the_site_gone
), guard as (
  select 1 / (count(*) = 1)::int as ok from changed
)
select c.*, g.ok from changed c cross join guard g;
```

**What is and is not proven (do not over-read this).** The write is proven by the returned row and a later read. The
*wording* inherits #588's caveats: competitor facts were checked on 2026-09-30 and go stale, and no legal review has
been done. There is no row-history table, so the pre-change body is recoverable only from the six "old" snippets in
the SQL above (each appears verbatim in it).

### Verification (the four, adapted: no repo change, so no merge)

**1. The database's own answer** (the statement's `RETURNING`, 09:47:27):
```
[{"id":"9a226072-885a-411b-8a6d-437956681f3c","slug":"ai-job-search-tools-nigeria-africa",
  "updated_at":"2026-09-20 10:13:36.644989+00","new_len":3419,
  "fully_automated_gone":true,"nothing_on_the_site_gone":true,"ok":1}]
```
A separate read-only query (2026-09-30 ~18:25 UTC) still shows: `updated_at` `2026-09-20 10:13:36.644989+00` (unchanged),
`len` 3419 (was 2,899), 5 "FreshTalent JobCopilot" mentions and 5 "JobCopilot" mentions in total (none bare), old
"nothing on the site" gone, the new Turbo line present.

**2. Repo / fresh clone:** not applicable — nothing in the repo changed. The SQL above is the durable record.

**3. Live production probe.** The page revalidates hourly (`revalidate = 3600`). A fetch seconds after the write
(Date 09:47:54 GMT, `x-vercel-cache: HIT`) still served the old text; it was not forced. Later fetches showed the
new text, and at 2026-09-30 18:25:31 UTC: `GET /blog/ai-job-search-tools-nigeria-africa` 200, "zPlatform" citation: 2,
old "nothing on the site": 0, old "fully automated": 0, `age: 65`, `x-vercel-cache: HIT`.

**4. Full suite:** not applicable (no code). The matching page changes are covered by PR #588's guard test.

### Not covered / still open
- Blog posts are not covered by #588's guard test; a future edit to this post can reintroduce an absolute claim.

---

## Merged 2026-09-30 — PR #582, honest marketing claims: no invented testimonial, no false company/scale claims (send-476)

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#582](https://github.com/Bayo-1987/Claude-Talentrah/pull/582) | `fix/honest-marketing-claims-476` | 2026-09-30 08:43:27 | `f0025908485602d04f22c7f31c53ae9ba7594f1e` |

**What it did.** Three untrue public claims, each verified before it was changed, plus one overstatement:
1. **An invented testimonial** on every login/signup/forgot/reset page (`auth-hero.tsx`): eyebrow "What job seekers
   say", a quote and an attributed name — only a code comment said it was fictional. Replaced with a product-truth
   "How Farah works" card.
2. **A false company/scale claim** on the homepage (`job-board-preview.tsx`): "Real openings from Flutterwave, Paystack,
   Andela and hundreds of other companies". Per the PR, production then had 662 open postings from 56 distinct companies and
   zero postings in any status matching Flutterwave, Paystack or Andela (checked in `company_name` and
   `description_preview`). The block is now labelled "Example listings", rows show role ·
   industry · location · work type with **no company field**, and the copy makes no count claim.
3. **An untrue footnote** ("match scores are calculated against a sample resume"; the 92/78/63 are hardcoded) — removed.
4. The JD-demo panel said "this is a live example"; it is a fixed illustrative sample — now "this is an example".
- **Guard test** `tests/marketing/no-unlabelled-social-proof.test.ts` (3 cases + a control): an attributed testimonial
  needs a visible "illustrative example" label; no unmeasured "hundreds/thousands of …" claims; homepage sample
  listings may not carry fields outside an allowlist.

**What is and is not proven (do not over-read this).** The guard is a text-shape check over source: it stops these
shapes of claim coming back unnoticed; it cannot make a claim true. `mentorship-section.test.tsx` could not run
without Supabase env locally (the PR recorded an identical failure on `main`).

### Verification (all four)

**1. GitHub API** — `GET /repos/Bayo-1987/Claude-Talentrah/pulls/582`:
```
{"merged": true, "merged_at": "2026-09-30T08:43:27Z",
 "merge_commit_sha": "f0025908485602d04f22c7f31c53ae9ba7594f1e", "state": "closed", "base": "main",
 "head_sha": "f51654f0a6360e3ff7dc2df44c032fb974f92240"}
```
Merged with a merge commit after `gh pr update-branch 582` (no other push) and all four required checks green.

**2. Fresh shallow clone** (`git clone --depth 80`):
```
merge SHA is an ancestor of HEAD: YES   (2 parents)
PRESENT: tests/marketing/no-unlabelled-social-proof.test.ts (145 lines)   src/components/auth/auth-hero.tsx (51)
         src/components/marketing/job-board-preview.tsx (100)
auth-hero has the "How Farah works" card: 1     job-board-preview "Example listings": 3
jd-demo-example "this is an example": 1
```

**3. Live production probe** (2026-09-30 18:24 UTC, signed-out): `GET /login` 200, "How Farah works" present (1);
`GET /` 200, "Example listings" present (1), "this is an example" present (1). (A grep for testimonial markers on
`/login` found 0 — that is a zero from a grep, so the positive assertions above and the CI guard are the evidence.)
Vercel deployment `dpl_5zNg4z8BBQzDnyTA4ysxu6XfKDDx`: `READY`, `production`, `githubCommitSha` = `f0025908…`, created
08:43:30 (3 s after the merge).

**4. Full suite against merged `main`** — CI run
[36691495776](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36691495776) (push, `f002590`), overall `failure`:
```
Typecheck, lint, unit tests : success   Test Files 358 passed (358)   Tests 4037 passed (4037)
Playwright e2e              : success   391 passed (9.2m)
Secret scan                 : success
Dependency audit            : FAILURE   -> overall run conclusion = failure
```
**Red for one reason, not this change:** the newly published `brace-expansion` advisory (dev-only), fixed by
PR #584 (merged 10:03 UTC the same day). `Migration drift (production)`: success
([run 36691495770](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36691495770)). On the PR's merged head
the same four required checks were green (run [36689495045](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36689495045)).

### Proof it can fail (red, then green)
- **Red:** guard test alone, run [36679529788](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36679529788)
  (head `b6ef42c`): `Typecheck, lint, unit tests` failed, Playwright skipped — exactly the three guard cases.
- **Green:** tip `ca1cefb`, run [36679805413](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36679805413):
  unit, Playwright, migration numbering and secret scan success (its overall `failure` is the Dependency audit above).

### Not covered / still open
- "Browse all jobs →" on the homepage still links `/jobs`, which login-gates signed-out visitors; it is a row on
  PR #590's ratchet allowlist, owner `prompt-3`.

---

## Merged 2026-09-30 — PR #579, blog scholarship-embed fallback links to a public page (send-475)

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#579](https://github.com/Bayo-1987/Claude-Talentrah/pull/579) | `fix/blog-embed-fallback-public-475` | 2026-09-30 07:12:08 | `a3116dc137093b40187b127c5ff3d46603a0894d` |

**What it did.** When a blog post's `[[scholarship:<id>]]` listing is no longer publicly visible, the embed rendered a
fallback that linked the bare `/scholarships` — which `proxy.ts` login-gates — so a signed-out reader clicking it
landed on `/login` at the moment the post stopped having the content they came for. The fallback now links the
public `/scholarships/apply-now`, and its copy no longer says "has since closed" (the ingest sends a published
listing whose content changed back to `pending`, so "closed" was untrue of a listing that may reopen): "This
scholarship's listing isn't currently available — it may have closed, or be under review. Browse the scholarships
open now." Files: `src/lib/blog/scholarship-embed.ts` and two tests. The verified-listing path is untouched.
- **When readers start seeing the fallback** (read from code in the PR): `markExpiredCycles` runs at the end of the
  daily 07:00 UTC `ingest-scholarships` cron with `STALE_AFTER_DAYS = 1`, so a deadline `D` is swept on the first run
  where today ≥ `D + 2`; the hard line for the nearest one (Trudeau, deadline 2026-10-02) was **2026-10-04 07:00 UTC**,
  plus up to an hour for the blog page's `revalidate = 3600`. The PR merged just under 4 days before it.

**What is and is not proven (do not over-read this).** The fallback itself **cannot be seen in production today**:
the 12 blog URLs listed in the sitemap were probed and none currently renders it (it only appears when an embedded scholarship is
unavailable). What is proven is the code path (CI tests that assert the fallback's href against the real
`isProtectedSeekerPath`, with a `/tracker` control proving the gate can return true) and that the target is public.
The DB-backed embed tests cannot run locally without Supabase env; CI is the evidence.

### Verification (all four)

**1. GitHub API** — `GET /repos/Bayo-1987/Claude-Talentrah/pulls/579`:
```
{"merged": true, "merged_at": "2026-09-30T07:12:08Z",
 "merge_commit_sha": "a3116dc137093b40187b127c5ff3d46603a0894d", "state": "closed", "base": "main",
 "head_sha": "c005cb4c321a96fa9cdcbcf0244b7e04b24956c5"}
```

**2. Fresh shallow clone** (`git clone --depth 80`):
```
merge SHA is an ancestor of HEAD: YES   (2 parents)
src/lib/blog/scholarship-embed.ts (138 lines): "/scholarships/apply-now": 2   login-gated href="/scholarships": 0
tests/blog/scholarship-embed.test.ts (156 lines): expectFallbackLinkIsPublic: 3
```

**3. Live production probe** (2026-09-30 18:24 UTC, signed-out): `GET /scholarships/apply-now` → 200 (the fallback's
target is public); `GET /scholarships` → 307 to `/login?redirectTo=%2Fscholarships` (still gated; a public
`/scholarships` landing is PR #595, open). 12 of 12 sitemap blog URLs probed for the fallback text: 0 render it (see
above). Vercel deployment `dpl_Eg9UJhWATBVhVS4QGoZF9fPPioGk`: `READY`, `production`, `githubCommitSha` = `a3116dc1…`,
created 07:12:11 (3 s after the merge).

**4. Full suite against merged `main`** — CI run
[36682356664](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36682356664) (push, `a3116dc`), overall `failure`:
```
Typecheck, lint, unit tests : success   Test Files 357 passed (357)   Tests 4033 passed (4033)
Playwright e2e              : success   391 passed (9.0m)
Secret scan                 : success
Dependency audit            : FAILURE   (the dev-only brace-expansion advisory; fixed by PR #584, 10:03 UTC)
```
`Migration drift (production)`: success ([run 36682356554](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36682356554)).
On the PR's merged head the four required checks were green (run
[36679862924](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36679862924)).

### Proof it can fail (red, then green)
Commit 1 (`b2660b7`, tests only) — run
[36678235000](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36678235000): `Typecheck, lint, unit tests`
failed (the two DB-backed embed tests asserting the fallback href), Playwright skipped. Commit 2 (`9e45109`) is the
fix; the required checks were green on the merged head.

### Not covered / still open
- Between a deadline passing and the sweep plus blog regeneration the post still shows the old card — pre-existing,
  unchanged here.

---

## Merged 2026-09-30 — PR #578, footer Scholarships link points at the public apply-now hub (send-474)

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#578](https://github.com/Bayo-1987/Claude-Talentrah/pull/578) | `fix/footer-scholarships-link-474` | 06:43:58 | `04fb1d6906ed002ae84bc1fa128d992104015a6f` |

**What it fixed.** The footer's "Scholarships" link pointed at the bare `/scholarships`, which is
login-gated (`src/proxy.ts` `PROTECTED_EXACT_PATHS`; the page calls `requireUser()`; `robots.ts`
disallows `/scholarships$`), so a signed-out visitor or crawler following it was redirected to
`/login`. It now points at `/scholarships/apply-now`, which is public, in the sitemap, and routes
signed-in visitors on to `/scholarships` and signed-out ones to signup with a `redirectTo`. Footer
only: one `href` changed, no other link touched. The regression tests assert the footer's `href`
against the real gate function and the real `robots()` rules (each with a control assertion), not a
hardcoded path.

### Verification (all four, per the standard above)

**1. GitHub API** — `GET /repos/Bayo-1987/Claude-Talentrah/pulls/578`:
```
{"merged": true, "merged_at": "2026-09-30T06:43:58Z",
 "merge_commit_sha": "04fb1d6906ed002ae84bc1fa128d992104015a6f", "state": "closed",
 "head_sha": "ea3a48fdc6cea8b1bffe0fd0f89f36f94b66b09d"}
```
Merge commit (2 parents), like #572, #574, #569 and #564.

**2. Fresh shallow clone** (`git clone --depth 20`, a temp dir, not the working copy):
```
HEAD: 04fb1d6906ed002ae84bc1fa128d992104015a6f   (Merge pull request #578 …)
merge SHA is an ancestor of / equal to HEAD: YES   (2 parents)
files changed by the merge: src/components/marketing/marketing-footer.tsx, tests/marketing/marketing-footer.test.tsx (53 insertions, 2 deletions)
footer line 59: { label: "Scholarships", href: "/scholarships/apply-now" }
old bare href at the merge SHA: 0     the same grep against the first parent: 1   (so the grep can match)
test file: send-474 block present
```

**3. Live production probe, post-merge** (2026-09-30 06:45:19–06:45:34 UTC, signed-out, read-only).
Vercel deployment `dpl_5bAsyodUu1U9UYQ3pYszHzLkBq7d`: `READY`, `target: production`,
`githubCommitSha: 04fb1d6906ed002ae84bc1fa128d992104015a6f`, aliased to `www.talentrah.com` and
`talentrah.com` (`aliasError: null`).
```
GET /                        200, exactly one Scholarships anchor: href="/scholarships/apply-now"
                             anchors to the bare /scholarships: 0   (control: the /refer anchor present)
GET /scholarships/apply-now  200, no Location header, title "Scholarships Open for 2026/2027: Every Deadline in One Place — Talentrah" (not the login title)
GET /scholarships            307 -> /login?redirectTo=%2Fscholarships   (control: the probe can see a redirect)
GET /sitemap.xml             200, 464 URLs, lists /scholarships/apply-now, does not list the bare /scholarships
```

**4. Full suite against merged `main`** — the CI run GitHub started on the merge commit
([run 36679776785](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36679776785), head `04fb1d6`):
```
Typecheck, lint, unit tests : success   Test Files 357 passed (357)   Tests 4033 passed (4033)
Playwright e2e              : success   391 passed (6.9m)
Secret scan                 : success   (Migration numbering: skipped on push events)
Dependency audit            : failure   (see below; not a required check)
```

### Proof the test catches the bug (red, then green)
Written first, with no database configured: against the unchanged footer `4 failed | 2 passed`
(the Product-column check, the apply-now `href`, the gate check reporting `/scholarships` as gated,
and the robots check reporting it disallowed); with the one-line fix `6 passed (6)`, and the restored
file identical to the committed one.

### What CI showed on the PR
- **Playwright e2e failed once in infrastructure, not in a test:** the "Start local Supabase" step
  hit Docker `toomanyrequests: Rate exceeded`, then `supabase db reset` exited 1 during "Initialising
  schema"; no test ran. One re-run of the failed jobs passed (`391 passed (9.1m)`). Not shown to be a
  recurring failure on `main`.
- **Dependency audit was red** on the PR and on `main`: a `brace-expansion` high-severity advisory
  (`GHSA-q2hr-2g5m-vwhr`, `GHSA-qhr7-859c-m2p7`, `GHSA-6j4f-fj2g-mc7p`) that turned `main`'s audit red from
  ~05:00Z that day, dev-only, not a required check; fixed separately by #584. **Lighthouse** was red for
  the known #575. Branch protection on `main` (strict mode) requires only Migration numbering,
  Typecheck/lint/unit tests, Playwright e2e and Secret scan.

### Process note
The first RED run of the new tests used `ALLOW_TESTS_AGAINST_HOSTED=yes-i-mean-it`, although the test
needs no database. That pointed the run at the shared preview project (`gtiksnbhnqmwpeckfqwk`, not
production), and the global teardown swept 2 stale `@talentrah.test` auth users
(`335b398e-f4d0-4e79-9003-b83511da3ae3`, `6a1c4ff0-b0bb-482b-8692-c00924573d38`): created 2026-09-29
21:02:46/47Z, deleted 05:30:56Z, so about 8.5 hours old against the sweep's 2-hour cutoff, throwaway
fixtures from two test files that had left them behind. Nothing needed restoring. Every later run used
no database configuration at all.

### Not covered / still open
- Scope was the footer only. Other surfaces that linked the bare `/scholarships` to signed-out
  visitors were listed as a follow-up decision: the blog `scholarship-embed` fallback was fixed by
  #579; the rest are now recorded, with owners, in #590's allowlist.
- **Lighthouse** stays red for #575.

---

## Operational 2026-09-30 — production blog post `cover-letters-that-dont-sound-like-a-template`: in-body link moved off a login-gated page (database change, blog-links audit follow-up)

| What | Where | When (UTC) | Row |
|------|-------|------------|-----|
| one guarded `UPDATE` of `public.blog_posts.body` | production (`nytwbbzfpytctjsoczzq`), via the Supabase connector | executed 2026-09-30 06:38:43, result 06:38:46 | `id 7ed1362e-506a-4a78-91a9-2ecc50a30e28` |

**What it did.** The post linked "(/tailor?coverLetter=1)" in its body. `/tailor` is behind the seeker gate
(`PROTECTED_PATH_PREFIXES`), so a signed-out reader of a public blog post who clicked it landed on `/login`. The link now
points at the public `/ai-resume-tailoring`. One substring replaced; `updated_at` deliberately left alone. Run after the
founder's explicit "yes".

```sql
with changed as (
  update public.blog_posts
     set body = replace(body, '(/tailor?coverLetter=1)', '(/ai-resume-tailoring)')
   where slug = 'cover-letters-that-dont-sound-like-a-template'
     and status = 'published'
     and body like '%(/tailor?coverLetter=1)%'
  returning id, slug, updated_at,
            body like '%(/ai-resume-tailoring)%' as has_new_link,
            body not like '%(/tailor?coverLetter=1)%' as old_link_gone
), guard as (
  select 1 / (count(*) = 1)::int as ok from changed
)
select c.*, g.ok from changed c cross join guard g;
```

**What is and is not proven (do not over-read this).** Only the in-body link was changed. The page still renders a
**page-chrome** link to `/tailor?coverLetter=1` ("Write your cover letter with Farah", from `RELATED_LINKS` in
`src/lib/blog/related-links.ts`); that is a known row on PR #590's gated-link allowlist (`main:/blog/* ->
/tailor?coverLetter=1`, owner `prompt-2`), not something this change touched. There is no row-history table; the old
text is recoverable from the `replace()` arguments above.

### Verification (the four, adapted: no repo change)

**1. The database's own answer** (`RETURNING`, 06:38:46):
```
[{"id":"7ed1362e-506a-4a78-91a9-2ecc50a30e28","slug":"cover-letters-that-dont-sound-like-a-template",
  "updated_at":"2026-09-18 06:45:44.489227+00","has_new_link":true,"old_link_gone":true,"ok":1}]
```
A separate read-only query (2026-09-30 ~18:25 UTC): `updated_at` still `2026-09-18 06:45:44.489227+00` (unchanged), `len`
2,427, the `/ai-resume-tailoring` link present, the old in-body link gone.

**2. Repo / fresh clone:** not applicable — the SQL above is the record.

**3. Live production probe** (2026-09-30 18:25:31 UTC): `GET /blog/cover-letters-that-dont-sound-like-a-template` 200; two
anchors to `/ai-resume-tailoring` ("Farah can help you find your own version of …" in the body, and the related-links
"Resume Tailoring"); the one remaining `/tailor?coverLetter=1` anchor is the page-chrome "Write your cover letter with
Farah" described above.

**4. Full suite:** not applicable (no code).

---

## Merged 2026-09-30 — PR #572, EmployerPrintButton waits for fonts before printing

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#572](https://github.com/Bayo-1987/Claude-Talentrah/pull/572) | `feat/employer-print-fonts-wait-473` | 2026-09-30 05:08:32 | `d1033091a57914e481e208cf3c229a038f7dfa03` |

**What it did.** `EmployerPrintButton` (the employer's "Print / Save as PDF" on an
applicant's resume) called `window.print()` synchronously; it now awaits
`waitForFontsSettled()` (bounded 3 s) and shows a disabled "Preparing PDF…" state.
No migration, no production data touched.

**What is and is not proven (do not over-read this).** With the wait removed the
font-state assertion in `e2e/employer-print-fonts.spec.ts` fails (8 faces still loading
when `print()` fires); with it, it passes. **No loss of content from printing early has
ever been reproduced** — the `blueprint` ATS failure that first suggested one was a
different cause (see #569). This is fidelity protection, not a proven ATS fix.

### Verification (all four)

**1. GitHub API** — `GET /repos/Bayo-1987/Claude-Talentrah/pulls/572`:
```
{"merged": true, "merged_at": "2026-09-30T05:08:32Z",
 "merge_commit_sha": "d1033091a57914e481e208cf3c229a038f7dfa03", "state": "closed", "base": "main"}
```

**2. Fresh clone** (`git clone --depth 30`, temp dir; `git checkout d1033091…`):
```
HEAD: d1033091a57914e481e208cf3c229a038f7dfa03   (Merge pull request #572 …)
is an ancestor of the current origin/main: YES
PRESENT src/components/employer/employer-print-button.tsx (53 lines)
PRESENT e2e/employer-print-fonts.spec.ts (169 lines)
PRESENT e2e/support/print-stub.ts (31 lines)
PRESENT src/lib/resume-builder/wait-for-fonts.ts (86 lines)
PRESENT supabase/migrations/0201_reset_test_pool_user_clear_mentorship.sql (200 lines)
button awaits the font wait: 1   imports wait-for-fonts: 2   synchronous onClick={() => window.print()} left: 0
```

**3. Live production probe** — *what this can and cannot show.* The change itself is
behind employer login, so it is not observable from outside; the probe therefore
establishes what production serves, via two independent routes:
- **Vercel API** (project `prj_Dhr20nuHigzGC27ZoYfBMdOawmdo`): the newest production
  deployment is `dpl_Ay9Rr6bASWA3ArBzcz9iyv32za26`, state `READY`, target `production`,
  created 2026-09-30T05:08:36Z (4 s after the merge), `meta.githubCommitSha` =
  `d1033091a57914e481e208cf3c229a038f7dfa03`. Its aliases include `www.talentrah.com` and
  `talentrah.com` (which redirects to `www`).
- **The live site** (2026-09-30 05:35:39 UTC): `talentrah.com` → one redirect → `www.talentrah.com`
  HTTP 200, `server: Vercel`, `x-vercel-cache: HIT`, `age: 1409` (cached since ~05:12, i.e. after
  the deploy).
- **Limit, stated plainly:** the live site exposes no build ID or commit (no `dpl_…` in the HTML,
  no deployment header), so the commit could *not* be read off the live site itself; this rests on
  Vercel's alias records plus the timing above. Earlier production deployments in the same list
  (`00ac9e0` #569, `82643bb` #574) are `READY`; one older one, `90219877` (send-465), is `ERROR`.

**4. Full suite against merged `main`** — CI run
[36672048430](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36672048430) (head `d1033091`):
```
Typecheck, lint, unit tests : success   Test Files 357 passed (357)   Tests 4030 passed (4030)
Playwright e2e              : success   391 passed (9.4m)   (includes employer-print-fonts, print-button-fonts)
Secret scan                 : success
Dependency audit            : FAILURE   -> overall run conclusion = failure
```
**The run is red for one reason only, and it is not this change:** three newly published
high-severity `brace-expansion` advisories (GHSA-q2hr-2g5m-vwhr, GHSA-qhr7-859c-m2p7,
GHSA-6j4f-fj2g-mc7p) now fail `npm audit --audit-level=high`. The audit passed on `main` at
2026-09-30 03:10 UTC (run 36663187293) and was red by 05:08, so the advisory landed in that
window. `brace-expansion` is not a production dependency (`npm ls brace-expansion --omit=dev`
is empty; it is pulled in by dev tooling). `Migration drift (production)` also ran on the
merge commit ([run 36672048535](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36672048535)): success.

**Required checks (branch protection, read via the API):** `main` requires exactly
`Migration numbering`, `Typecheck, lint, unit tests`, `Playwright e2e`, `Secret scan`, with
`strict: true` (branches must be up to date). **`Lighthouse CI…` and `Dependency audit` are
not required**; no rulesets are configured. All four required checks passed on #572.

### Not covered / still open
- `Dependency audit` is red on `main` today (advisory above); a fix (`npm audit fix` or an override)
  is a separate change and is not made here.
- Lighthouse is red on every recent run; tracked in [#575](https://github.com/Bayo-1987/Claude-Talentrah/issues/575).
- `refresh-job.test.ts` flake: [#577](https://github.com/Bayo-1987/Claude-Talentrah/issues/577).

---

## Work chain: the `mentor_profiles_pkey` flake (PRs #562, #563, #574), 2026-09-29

Recorded together because the fix arrived in three steps and only the last one is a root-cause fix.
- **#562** — per-file: `reviewer-claim-race.test.ts` bare inserts → `upsert`.
- **#563** (commit `e682f16`) — per-file: `dual-role-isolation.test.ts` the same.
- **#574** — root cause: `reset_test_pool_user` now clears a former mentor's/mentee's mentorship rows
  child-first (migration `0201`; see the #574 entry below for the mechanism and its four-part
  verification, including the production apply).
- **Empirical check, and its limit.** A recount of the CI history found **6 pkey-class failures on
  2026-09-29** (`dual-role-isolation` ×5, `display-name` ×1), **all before `0201` merged**
  (latest 20:43:05 UTC; `0201` merged 21:23:40 UTC). Since the merge, **0 of the 6** unit-job attempts
  that started failed this way. **Six clean attempts is far too few to claim the flake is gone**
  (rule of three: a 95% upper bound of ~50%); what proves the *mechanism* is the deterministic
  regression test, written red-first. Treat the absence of recurrence as encouraging, not as proof.

---

## Merged 2026-09-29 — PR #574, `reset_test_pool_user` clears a former mentor's/mentee's mentorship rows (0201)

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#574](https://github.com/Bayo-1987/Claude-Talentrah/pull/574) | `fix/mentor-profiles-pkey-root-cause` | 21:23:40 | `82643bbc3d13be6c01af436c83be0906b9ff59d2` |

> **Maintenance gap, stated plainly.** Before this entry, the last thing recorded
> in this file was PR #64 (2026-08-26). Every PR between #65 and #573 (about 510
> PR numbers; not all of them merged) is **not** recorded here, and this entry does
> not backfill them. Reconstruct anything
> from those from `git log` / `gh pr view`, not from this file.

**What it fixed.** The recurring `mentor_profiles_pkey` CI flake (three test
files in one day: #562, #563, and `display-name.test.ts` on #572's CI; ~29 bare
inserts across ~20 files carry the same exposure). Root cause, verified against
the live FK graph: 0188's `reset_test_pool_user` deleted `mentor_profiles` first,
blocked by three NO ACTION NOT NULL FKs (`mentorship_sessions.mentor_id`,
`mentorship_reviews.mentor_id`, `mentor_payouts.mentor_id`), only cleared sessions
where the user was the *mentee*, and never touched `mentor_payouts`; the blocked
delete was swallowed by its `foreign_key_violation` handler, so the residual was
silent until the next claimant's bare insert collided. 0188's "accepted residual"
note was wrong — the FKs resolve child-first. 0201 adds four guarded child-first
deletes above the existing loop. Function body only; grants and signature
untouched. It never touches the counterparty's rows.

**This one touched production directly.** 0201 was applied to production **before**
merge (the repo's rule for additive migrations, `supabase/migrations/README.md`),
by `apply_migration` through the connector with the same statement applied to the
dev project. It is a no-op there today: production's test pool has 0 rows.

### Scope: test-only, with evidence (checked before touching production)
- **Repo:** every reference to `reset_test_pool_user` / `claim_` / `release_` /
  `add_test_pool_user` is in `tests/`, `supabase/migrations/`, docs, or the
  *generated* `src/lib/supabase/types.ts` (declarations, not calls). Nothing under
  `src/app`, `src/lib`, `scripts/` or `.github/` calls them.
- **Production database:** all four are `SECURITY DEFINER`; `anon` and
  `authenticated` have no `EXECUTE`, only `service_role`; the only other function
  whose body references `reset_test_pool_user` is `claim_test_pool_user`; no
  policy, view or trigger mentions the pool; `pg_cron` is not installed. The
  privilege lock is also pinned by `tests/rls/test-user-pool-privileges.test.ts`.

### Verification (all four, per the standard above)

**1. GitHub API** — `GET /repos/Bayo-1987/Claude-Talentrah/pulls/574`:
```
{"merged": true, "merged_at": "2026-09-29T21:23:40Z",
 "merge_commit_sha": "82643bbc3d13be6c01af436c83be0906b9ff59d2", "state": "closed"}
```

**2. Fresh shallow clone** (`git clone --depth 20`, a temp dir, not the working copy):
```
HEAD: 82643bbc3d13be6c01af436c83be0906b9ff59d2   (Merge pull request #574 …)
merge SHA is an ancestor of / equal to HEAD: YES
PRESENT: supabase/migrations/0201_reset_test_pool_user_clear_mentorship.sql (200 lines)
PRESENT: tests/support/test-user-pool-mentor-reset.test.ts (200 lines)
new-block warning strings in the migration: 4
CLAUDE.md corrected paragraph present ("0201 now does it"): 1
highest migration number on main: 0201_reset_test_pool_user_clear_mentorship.sql
```

**3. Live production probe, post-merge** (2026-09-29 21:24:24 UTC, 44 s after merge;
project `nytwbbzfpytctjsoczzq`, read-only):
```sql
select now() as probed_at,
  (select count(*) from supabase_migrations.schema_migrations
     where name = '0201_reset_test_pool_user_clear_mentorship') as ledger_0201_count,
  (select position('mentor_payouts (as mentor)' in prosrc) > 0 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'reset_test_pool_user') as live_fn_has_0201_blocks,
  (select md5(prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'reset_test_pool_user') as live_fn_md5,
  (select count(*) from public.test_user_pool) as pool_rows;
```
```
ledger_0201_count = 1   (newest entry: version 20260929211020, applied 21:10:20 — before merge)
live_fn_has_0201_blocks = true
live_fn_md5 = 3fe4efed69cbd21bfff68bb9d32b3f93   (identical to the md5 right after apply)
pool_rows = 0
anon/authenticated can execute = false
```
Before apply the same probe read md5 `0d116c15aa1412f1fd799a3b9e145bc7` (3,450 chars,
no new blocks, ledger count 0); after, 4,471 chars, new blocks present. The repo's
own **"Migration drift (production)"** workflow also ran on the merge commit
([run 36632970393](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36632970393))
and concluded `success`.

**4. Full suite against merged `main`** — the CI run GitHub started on the merge
commit ([run 36632970518](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/36632970518),
head `82643bb`), concluded `success`:
```
Typecheck, lint, unit tests : success   Test Files 357 passed (357)   Tests 4030 passed (4030)
Playwright e2e              : success   390 passed (8.9m)
Dependency audit, Secret scan: success   (Migration numbering: skipped on push events)
```
The new regression test ran in that run (`test-user-pool-mentor-reset.test.ts`,
2 tests passed), as did `tests/mentorship/display-name.test.ts` (4 tests passed) —
the file that had failed on #572's CI.

### Proof the fix fixes something (red, then green)
`tests/support/test-user-pool-mentor-reset.test.ts` was written first and run
against the *unfixed* function on the dev project: both tests failed on exactly the
two expected assertions (the former mentor's `mentor_profiles` row survived; the
former mentee's session survived because a payout referenced it). After 0201 both
pass, and the 5 existing `test-user-pool.test.ts` tests still pass (7/7).

### Not covered / still open (do not read this entry as saying otherwise)
- **A single green CI run cannot prove a probabilistic flake is gone.** The
  deterministic regression test is what proves the mechanism; the flake's absence
  over time is not something one run demonstrates.
- **`refresh-job.test.ts` is a different flake and is NOT fixed by this.** Tracked in
  issue [#577](https://github.com/Bayo-1987/Claude-Talentrah/issues/577). (An earlier
  version of this bullet said "three runs, no issue" — superseded: a defensible recount
  found **8 failures in 47 first attempts, 17.0%, 95% CI 8.9–30.1%**, and the failing logs
  show a concrete mechanism, described in #577.)
- **Lighthouse** is red on every recent run for an unrelated reason; tracked in
  issue [#575](https://github.com/Bayo-1987/Claude-Talentrah/issues/575).
- Local runs against the dev project fail for tests that mint a JWT session with
  `No suitable key or wrong key type` (an environment/signing-key mismatch that
  predates this change); those tests were only ever verified green in CI.
- The statement applied to the two projects omitted 0201's leading header comment
  block (documentation only); the function statement is identical to the file.

---

## Merged 2026-08-26 — PR #64, local runs cannot hit production; CI seeds before testing

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#64](https://github.com/Bayo-1987/Claude-Talentrah/pull/64) | `fix/local-and-ci-target-the-ci-project` | 19:31:27 | `5635154` |

The two threads left over from giving CI its own Supabase project.

**1. `tests/setup.ts` refuses to run against production.** `.env.local` was
repointed at the CI project, but the guard is the actual fix: an unrepointed env
file looks and behaves exactly like a correct one until you check what it wrote,
which is how local runs hit production twice in one session without being
noticed. It is also the backstop for the worse case — a GitHub secret
misconfigured back to production would otherwise run the whole suite, seed
included, against live data with nothing to stop it. Escape hatch is
`ALLOW_TESTS_AGAINST_PRODUCTION=yes-i-mean-it`, which has to be typed on a
command line so it cannot happen by drift.

**The service-role key in `.env.local` is a placeholder** and must be pasted by
hand from Talentrah CI → Settings → API. Nothing local works until it is, which
is deliberate: a half-repointed file still holding a production service key is
the exact failure the repoint exists to prevent.

**2. The seed deadlock is gone.** `npm run seed` needs a dev server so it lives
in the Playwright job, which is `needs: checks` — on a never-seeded database the
unit tests ran first, failed on a missing catalog, and skipped the job that
would have fixed them. `npm run seed:catalog` writes reference data straight to
the database with no app involved and runs in the checks job before typecheck.
Idempotent.

Scholarships carry their moderation state because reproducing it matters:
`cross-user.test.ts` asserts a verified one is visible to a signed-in user and a
pending one is not, so a catalog with only one state would leave that gate
untested rather than failing loudly.

### Verified by experiment, not by a green tick

The CI project's `scholarships` table was **emptied to 0 before pushing**. If the
new step did nothing, `cross-user` would have crashed at file level reading
`.id` of null, exactly as it did the first time the suite met a fresh database.

```
before push          scholarships = 0
after the CI run     scholarships = 8   (5 verified / 3 pending)
                     cross-user passed
                     catalog otherwise intact: 11 templates, 3 packs, 2 passes
```

### Recorded because it explains why this class of bug survives

Widening that test by also clearing `passes` and `credit_packs` was refused:
FKs from seeded `user_passes` block the delete. **A fresh-project state cannot
be simulated by deleting on a used one** — which is part of why "works because
the data has been there for weeks" goes unnoticed for so long.

### Verified, four-point standard

1. **PR API** — `merged: true`, `merged_at 2026-08-26T19:31:27Z`,
   `merge_commit_sha 5635154a015d0b65a1cd21718690710ad95a0a71`.
2. **Fresh clone** — `scripts/seed-catalog.ts` present; the production guard in
   `tests/setup.ts`; the seed step ahead of Typecheck in `ci.yml`.
3. **Live probe** — the restore above, measured against a table this session
   emptied on purpose.
4. **CI green on the merged head** — 5/5.

---

## Merged 2026-08-26 — PR #63, ad serving reaches the feed. Arc complete.

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#63](https://github.com/Bayo-1987/Claude-Talentrah/pull/63) | `feat/ad-serving-feed` | 18:59:09 | `ee56800` |

The last piece. An employer can now fund a wallet, create a campaign, have it
reviewed, start it, be charged daily — and a seeker actually sees it, labelled,
in a position that still respects their own filters and match tier.

**Recommended only (D4).** External, Saved and Recent are user intents, not
discovery surfaces; Recommended is the only tab whose ordering Talentrah
chooses, so it is the only one where selling a position in that ordering is
coherent.

**It reorders rather than appends.** A promoted job already satisfies the tab's
filters, so it is already in `scored`. Any promoted row NOT present there is
dropped before impressions are recorded — billing for a card that never
rendered is the one failure this could not have. Verified in the merged file:
the `scoredIds.has(...)` filter at `page.tsx:148` runs before
`recordPromotedImpressions` at `:167`.

**The floor is passed explicitly (60)** rather than inherited from
`promoted_jobs`' default, so the reason sits next to the number: 60 is the
bottom of the match-tier system, and below it a card would show a score the
design has no word for.

**The badge is solid `--ink`**, like the company badge and for the same reason —
the three match tiers own green, rust and amber, and a fourth coloured pill
would read as a fourth tier.

**D3 is recorded in the data**: the surface is `job_feed_render`, so whoever
bills on these later reads the counting method off the row instead of inferring
it. These over-count deliberately — the card was emitted, not necessarily seen.

### Verified, four-point standard

1. **PR API** — `merged: true`, `merged_at 2026-08-26T18:59:09Z`,
   `merge_commit_sha ee5680077fdc442fee38eef8ac5a666b78862897`.
2. **Fresh clone of `main`** — `src/lib/ads/promoted.ts` and
   `ad-serving-feed.test.ts` present; the visible-before-impression ordering
   confirmed in the merged page, not the diff.
3. **Live probe** — production serving: `/` 200, `/jobs` 307,
   `/employer/campaigns` 307. No migration needed; 0052 went to production when
   #62 merged.
4. **CI green on the merged head** — 5/5, both new suites passing on the first
   run.

### The impression write stays on the critical path, knowingly

It is awaited inside the Recommended render. Dedup makes it a no-op after the
day's first hit and it can never fail the page, but it is a round trip on the
busiest surface in the app. Deferred deliberately: moving it off-path correctly
needs Next.js's `after()`, not merely dropping the `await` — a floating promise
in a server component may be killed when the response finishes, which would
lose events silently. Not worth doing until a real campaign makes the latency
measurable.

---

## Merged 2026-08-26 — PR #62, ad serving schema: ad_events and promoted_jobs (0052)

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#62](https://github.com/Bayo-1987/Claude-Talentrah/pull/62) | `feat/ad-events-and-promoted-jobs` | 18:21:27 | `0a62327` |

Campaigns had been chargeable since 0047 and readable by nobody outside the
employer surface since 0047. This is the half that makes the charge correspond
to something.

**`promoted_jobs` TAKES NO USER ID, and that is the whole security design.**
The obvious signature had `p_user_id` and would have been a data leak: it is
SECURITY DEFINER and executable by `authenticated`, so any signed-in caller
could have passed someone else's id and read their match scores back. The
seeker comes from `auth.uid()`, which a caller cannot forge. Called as
service_role, `auth.uid()` is null and it returns nothing — the right answer,
since there is no promoted set without a seeker to promote to.

It exists at all because `ad_campaigns`' only SELECT policy is
`is_org_member(organization_id)`, so a job seeker sees nothing — correctly,
since that table holds budgets, spend and review notes. The function is the
narrow hole through it: job ids and campaign ids, not one money column.

`p_user_id` DOES still appear in 0052, on `record_ad_event`, which is
service_role-only and takes the user as data. Noted because a future reader
will grep, find it, and wonder whether the leak above was really closed.

**D1** — a promoted job must clear the seeker's own filters and the same match
threshold as an organic result. The filters are arguments to the function
rather than something the feed applies afterwards: filtering after the fact
would return a job and then hide it, billing an impression for a card nobody
saw.

**D3 / dedup** — §8 requires ad events to be deduplicated before billing
touches them. Billing is per-day today and does not read `ad_events` at all,
but CPC is the stated next step and a log that was never dedupable cannot be
made billable afterwards. The bucket is computed inside `record_ad_event` so no
caller can disable dedup for its own events: impressions and applies by day,
clicks by minute. `user_id` is NOT NULL because a nullable column would need a
sentinel to dedup anonymous rows, and a sentinel that never occurs is a hole
waiting for the day it does.

### Verified, four-point standard

1. **PR API** — `merged: true`, `merged_at 2026-08-26T18:21:27Z`,
   `merge_commit_sha 0a62327fd054b4884b00922ce8efd55a50bab772`.
2. **Fresh clone of `main`** — 0052 and `ad-serving.test.ts` present;
   `auth.uid()` appears 4× in the merged migration.
3. **Live probe** — 0052 applied to production at merge time. Both projects
   then verified identical: 29 tables, 37 policies, 27 functions, 26 public
   enums; `ad_events` not writable by anon/authenticated; `promoted_jobs`
   executable by `authenticated,postgres,service_role`; `record_ad_event` by
   `postgres,service_role` only. `promoted_jobs()` as service role returns 0.
   The path is inert in production — 0 active campaigns, 0 events.
4. **CI green on the merged head** — 5/5.

### Verified by impersonating sessions in SQL

Rather than trusting the `auth.uid()` derivation, it was exercised:

```
seeker sees own promoted job          1  expect 1
D1 work_type filter binds             0  expect 0
D1 score threshold binds (score 95)   0  expect 0
D1 employer targeting binds           0  expect 0
SECURITY other user sees nothing      0  expect 0
service role (auth.uid null)          0  expect 0
paused campaign not served            0  expect 0
```

That probe incidentally confirmed 0048's transition trigger refuses a status
write even from a superuser session — it keys on `auth.role()`, not the
database role.

### The fifth instance of the unchecked-write bug, this time mine

CI failed the first run on `a campaign past its end date is not promoted`.
The test did a bare `admin.from("ad_campaigns").update({ends_on})`, which
`ad_campaigns_ends_after_starts` REJECTED because `starts_on` defaults to
today — and because the error was never read, the test proceeded believing its
own setup. Measured:

```
old form: ends_on only          REJECTED 23514
  ends_on after old form        NULL — setup silently did nothing
new form: starts_on + ends_on   accepted
```

In a PR whose commit message argues for checking errors. The habit held in the
code under test and lapsed in the scaffolding around it, which is where it
lapsed the previous four times too. Every campaign mutation in that file now
goes through a helper that throws with the code.

---

## Merged 2026-08-26 — PR #61, seed owns the paid catalog (0051)

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#61](https://github.com/Bayo-1987/Claude-Talentrah/pull/61) | `feat/seed-owns-the-catalog` | 18:20:16 | `bc560df` |

Standing up the CI project found `credit_packs` and `passes` EMPTY with nothing
able to fill them. They exist in production only because one of the uncommitted
0001–0025 migrations inserted them once. `scripts/seed.ts` owned every other
catalog and did not know these two existed.

**The brief for this PR contained a false premise, and saying so was the work.**
It asked to "backfill the other resume templates" — but `RESUME_TEMPLATES`
already lists all eleven including 0042's four. The CI project lacked them
because seed had never run there, which is an ORDERING problem, not a gap in
the seed. No change was made there rather than a no-op dressed up as a fix.

0051 adds unique constraints on `credit_packs.name` and `passes.name`. The seed
upserts every other catalog against a stable key — `resume_templates` got
`slug` in 0042 for exactly this reason — and these two had only `id`, which the
seed does not know. Verified no duplicate names existed in either project
first. `is_active` is written on insert but deliberately not on update:
deactivating a pack is an operational decision, and a re-seed must not quietly
switch it back on.

Verified the constraint does the work rather than the test's optimism —
dropping it on the CI project and retrying the duplicate returned
`ACCEPTED both`, then it was restored with no probe rows left behind.

### Verified, four-point standard

1. **PR API** — `merged: true`, `merged_at 2026-08-26T18:20:16Z`,
   `merge_commit_sha bc560dff0f4416e5d81858e31a274a9eede9cc17`.
2. **Fresh clone of `main`** — 0051, the seed catalog constants and
   `tests/seed/catalog.test.ts` all present.
3. **Live probe** — production catalog intact: 3 credit packs, 2 passes,
   11 templates, 8 scholarships; `credit_packs_name_key` present.
4. **CI green on the merged head** — 5/5.

### Still open

Unit tests run BEFORE `npm run seed` in CI — seed lives in the Playwright job,
which is `needs: checks` — so a fresh project still fails its first run until
its reference data is bootstrapped out of band. An ordering problem in the
workflow, not a gap in the seed.

---

## Set up 2026-08-26 — CI runs against a second Supabase project

Not a PR. Infrastructure, recorded because it changes what every entry below
this one means: a test run can no longer damage production.

| | Project | Role |
|---|---|---|
| Production | `nytwbbzfpytctjsoczzq` | Vercel points here. Untouched by the repoint |
| CI | `dozaffzgqkbarxtlclsj` — "Talentrah CI", eu-north-1, free tier | GitHub Actions secrets point here |

**Cost: $0/month.** Free tier allows 2 active projects. Pro ($25/mo) buys
per-PR branch isolation at $0.01344/branch/hour — deferred until there is a
second concurrent contributor, since #57's per-ref concurrency already
serialises the one-at-a-time case.

**The costed argument, including the part that weakened it.** The case was
originally put as "seven infra defects today, all downstream of testing against
production". On honest re-count that was overstated: roughly **three of eight**
were genuinely shared-database (borrowed fixtures, auth rate limits, residue
landing in production). The rest — the `listUsers()` pagination class, the
ingest route's 200-on-total-failure, the unchecked deletes — would have
happened anywhere. A staging database makes their consequences harmless; it
does not prevent them.

### No workflow change was needed

`ci.yml` hardcodes no project ref — it reads `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` from secrets.
Updating the secret values IS the repoint. Checked rather than edited.

### How the schema got there, and what to trust

All 26 migrations replayed through the MCP connector — there is no PAT in this
repo, `psql` is not installed and the Supabase CLI is not either, so
`supabase db push` was not available. Verified against production rather than
assumed:

```
tables 28 = 28      policies 36 = 36      functions 25 = 25
public/auth triggers 7 = 7                public enums 25 = 25   (identical names)
authenticated UPDATE column grants        BYTE-IDENTICAL
```

That last line is the one that matters — every `revoke`/`grant (cols)` from
0028, 0030, 0033, 0041 and 0047 reproduced exactly, with `farah_messages`,
`referral_shares` and `match_scores` correctly absent from both. The count gaps
that looked alarming (12 vs 11 triggers, 37 vs 35 enums) were Supabase-managed
`storage`/`realtime` objects.

One deliberate textual deviation: 0045 embeds literal zero-width characters in
a regex, and transcribing those blind is how the JS/SQL drift bug happened in
the first place. Written with `\uXXXX` escapes instead and proved equivalent
across all 11 cases, each of U+200B/200C/200D/2060/180E/FEFF included.

### Proved in both directions

A snapshot before the first green run, and the same query after:

```
production @ 17:15:53Z   35 auth users, 2 orgs, 166 postings, 11 templates
production after run 206 35, 2, 166, 11   — and 0 test-shaped users created since
CI project after run 206 3 seed accounts, 1 org, 149 postings, 8 scholarships
```

Test data landed in CI; production did not move a row. That is the
confirmation, not the green tick — if CI were still pointed at production those
throwaway rows would have appeared there.

### What the first run found, which is the point of doing it

Two hidden dependencies on ambient production data, invisible for as long as
the only database anyone used already had it:

* `template-registry.test.ts` — the CI project had only 0042's four templates.
  seed lists all eleven; it had simply never run there.
* `cross-user.test.ts` — crashed at file level reading `.id` of null. It
  borrows a SCHOLARSHIP the same way it used to borrow a job posting, and a
  fresh project has none. Third and fourth instance of that class, after #59
  and #60 — the sweep those PRs ran covered `job_postings` and not every shared
  table.

### Standing caveats

- **A LOCAL run still hits production.** The isolation is CI-only; `.env.local`
  is unchanged.
- **Both projects need every migration**, and they are deliberately allowed to
  diverge while a PR is in review — CI on write, production on merge.
- **Reference data was bootstrapped by hand** (templates, scholarships, credit
  packs, passes). [PR #61](https://github.com/Bayo-1987/Claude-Talentrah/pull/61) teaches seed the two catalogs it never knew, but
  the ordering problem remains: unit tests run before seed, so a fresh project
  still fails its first run until its reference data exists.

---

## Merged 2026-08-26 — PR #60, tests own the job postings they write against

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#60](https://github.com/Bayo-1987/Claude-Talentrah/pull/60) | `fix/tests-own-their-job-postings` | 15:00:28 | `4f1d9d7` |

Third and final instance of the borrowed-fixture defect, after the tracker suite
(#54/#58) and auto-apply's internal postings (#59).

A row selected with `.limit(1)` — no ordering, no ownership — and held for a
whole file can be deleted by its owning suite in between, because up to 33 files
run in parallel against one production project. The insert then fails 23503, and
these call sites rarely check the error.

**Demonstrated.** Reproducing the old borrowing in `cross-user.test.ts` and
deleting the row before use:

```
Error: seed applications: insert or update on table "applications"
violates foreign key constraint "applications_job_posting_id_fkey"
Tests  38 skipped (38)
```

Note the shape: `beforeAll` throws, so **every test in the file skips** — a
silent zero-coverage run, not a visible failure. With the fix, 38/38 pass.

Fixed in three files: `cross-user.test.ts` (one site, held file-wide),
`column-privileges.test.ts` (three sites) and `enforcement.test.ts` (the
external posting, whose `external_source` is a value no configured source uses,
so the per-source ingest freshness pass can never close it).

`cross-user.test.ts`'s header claimed *"It only ever touches rows it created"* —
the borrow made that false. Same class as the false comment in #54. It now
states what is true and what was not.

### A claim checked and withdrawn

I expected the two NEGATIVE tests in `column-privileges` — which assert an
insert is refused — to have been passing on 23503 rather than a permission
denial, a false green in the suite whose job is proving column grants hold. It
would have been the most serious of the three findings.

**Measured: wrong.** Pointing the insert at a nonexistent uuid still yields
42501, because Postgres evaluates the column-grant denial BEFORE the foreign
key. Those two were never losing coverage; only the third, which inserts through
the service role and expects success, would have broken. The code comment
records the measurement, not the guess.

The error-code assertion added there is kept for a different reason than first
given: `.not.toBeNull()` is satisfied by ANY error, so it would survive the
refusal becoming something incidental.

### `deletePostingsCascade`

Extracted from `deleteOrgsCascade`. A posting with NO organisation — the
external fixture — cannot be reached by an org delete, and the global sweep
works from the organisation allowlist, so nothing would ever have swept it.

Worth recording why extracting beat hand-rolling: the hand-rolled version got
the FK facts wrong on the first attempt. It used
`job_tailoring_requests.job_posting_id` (the column is `source_job_posting_id`)
and would have DELETED resumes that merely reference a posting instead of
unlinking them. `tsc` caught the column name; the resumes part was only right
after reading `delete-orgs.ts`. That module exists to hold these facts once.

### Verified, four-point standard

1. **PR API** — `merged: true`, `merged_at 2026-08-26T15:00:28Z`,
   `merge_commit_sha 4f1d9d7e3612a0f5754e56b3834b95cf08f5127b`.
2. **Fresh shallow clone of `main`** — parents `a9dea9b` + `b68414a`.
   `deletePostingsCascade` exported; all three new fixture patterns registered;
   the corrected header present. A scan of the merged tree for surviving
   borrowers returns exactly one hit, `cross-user.test.ts:420`, which is a
   READ-ONLY visibility assertion — it never holds the id or writes against it,
   and the new `verified: true` fixture org makes it strictly more robust by
   guaranteeing a visible posting exists.
3. **Live probe** — not applicable; this is test-only and reaches no production
   surface. Recorded as N/A rather than skipped. What was checked instead is
   residue: after running the four affected suites repeatedly, production holds
   **2 organisations (both real), 0 fixture-shaped orgs, 0 fixture-shaped
   postings**, and auth users are down to 31 from the 50 that was one account
   short of breaking the seed.
4. **CI green on the merged head** — 5/5.

---

## Merged 2026-08-26 — PR #59, a totally failed ingest answers 500 (and one regression I caused)

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#59](https://github.com/Bayo-1987/Claude-Talentrah/pull/59) | `fix/ingest-route-reports-source-failures` | 14:36:28 | `c7c534d` |

Came out of chasing "2XX with real external calls but zero rows written" on the
05:00 ingest cron. **There was no such bug** — see the cron investigation entry
above for why the measurement was invalid. Two real things came out of it
anyway.

### 1. The route could not have told us either way

`ingestAllSources` catches per source and records the reason in
`results[].error` — correct, since one dead board must not stop the others. But
that reason travelled only in a **200 response body**, and nothing reads a body:
Vercel records the status code, so a run where EVERY source failed was
indistinguishable from a quiet day with no new postings.

Total failure now answers **500**; partial stays **200**, because the run did
real work and one dead board is exactly what the per-source catch exists for.
Failing sources and reasons are logged rather than left in the body. Both
behaviours pinned in `contract.test.ts` §2b.

### 2. A regression this session caused, in a suite it had not touched

CI failed with:

```
AssertionError: not enough seeded internal postings to exhaust the
free allowance: expected 0 to be greater than or equal to 3
```

The message blames the seed. The seed was fine — 4 open internal postings, both
real organisations present, verified by SQL. `tests/auto-apply/enforcement.test.ts`'s
`beforeAll` took whatever `job_postings` returned first for
`source_type = internal AND status = open` with `limit(3)` — no ordering, no
ownership — then held those ids for the whole file.

**PR #54/#58 is what started tripping it.** Giving the tracker suite its own
internal, open fixture postings created transient rows of exactly the shape this
query grabs. Fixing one borrowed fixture by creating a real one made the *other*
borrower fail. Worth remembering: converting a suite from borrowing to owning
adds rows that other borrowers can pick up.

Auto-apply now creates an `AUTOAPPLY-TEST Org` (already in
`FIXTURE_NAME_PATTERNS`) with three postings of its own, cleaned up via
`deleteOrgsCascade`, org first. Its filler upsert now checks its error — the
fifth instance today of resolves-without-throwing.

### Verified, four-point standard

1. **PR API** — `merged: true`, `merged_at 2026-08-26T14:36:28Z`,
   `merge_commit_sha c7c534dd62e77814261b7ec772fdeb4f21fdc1ba`.
2. **Fresh shallow clone of `main`** — parents `f558b98` + `2d87191`. The
   total-failure guard confirmed at `ingest-jobs/route.ts:69`; the owned fixture
   postings and the checked filler upsert both present in the merged test file.
3. **Live probe** — the route still fails closed on production
   (`GET` and `POST` with no credential both `401 {"error":"Unauthorized"}`).
   The healthy path was proven before merge by running the pipeline directly:
   greenhouse/moniepoint 126 upserted, schema-org/workable 20 upserted, 0
   errors, and SQL confirming all 146 rows moved.
4. **CI green on the merged head** — 5/5.

### Still borrowing — chipped, not fixed

The sweep for other instances of this pattern (the one PR #53 failed to do for
`listUsers()`) found two more:

* `tests/rls/cross-user.test.ts:105` — `.limit(1).single()` on `job_postings`,
  held for the whole file, applications created against it. Highest remaining
  risk.
* `tests/auto-apply/enforcement.test.ts` — the `externalJobId` lookup. Lower
  risk, since external rows come from the ingest pipeline rather than fixtures,
  but still unowned.

Deliberately not folded into this PR: restarting a nearly-green CI run to carry
an unrelated fix is what consumed several cycles earlier in the session.

---

## Investigated 2026-08-26 — "the production crons aren't running". They are.

Recorded in full because **this file carried the wrong conclusion for part of
the afternoon**, and because the way it went wrong is more reusable than the
answer.

### The claim, and why it was wrong

I reported that Vercel crons were not firing, so the billing loop was "closed in
code and open in production". The evidence was that
`job_postings.last_checked_at` showed no batch at the 05:00 cron hour across
eight days.

**`last_checked_at` is LAST-WRITE-WINS PER ROW, not an audit log.** Every ingest
overwrites all 146 external postings with the current timestamp, so at any
moment exactly ONE batch timestamp exists — the latest run — plus stragglers
from tests that touched single rows. CI runs the ingest against production
constantly, so the 05:00 cron's timestamps were overwritten later the same day,
every day. The absence of an 05:xx batch was not evidence of anything.

Demonstrated rather than argued: running the pipeline moved all 146 rows to
`14:12`, and the `13:30` batch that had been there minutes earlier was simply
gone.

### What is actually true, from the Vercel dashboard

| Cron | Schedule | Invocations (12h) | Status | Real work |
|---|---|---|---|---|
| `ingest-jobs` | `0 5 * * *` | 1 | **2XX**, 0% error | workable ×21, greenhouse ×1, supabase ×4 |
| `renew-passes` | `0 6 * * *` | 1 | — | 2.69s |
| `ingest-scholarships` | `0 7 * * *` | 1 | — | 2.59s |
| `charge-campaigns` | `0 8 * * *` | 5 | **4XX** | none — these are manual curls |

Cron Jobs is **Enabled**; all four registered. `ingest-jobs` returning 2XX means
`requireCronSecret` PASSED, so **`CRON_SECRET` is set and correct** — closing a
carried-forward founder item that had been open since the API contract work.

`charge-campaigns` merged at ~11:30 UTC, after that day's 08:00 slot, so its 5
invocations are all 4XX from manual probes and its first scheduled run is the
following 08:00 UTC. The mechanism and the secret are proven on a sibling route,
so **the billing loop is closed in production too**.

### Two hypotheses that were wrong, and one retraction

* **Plan cap.** Ruled out: Vercel lifted Hobby's cron limit to 100/project on
  2026-01-20 and this project declares four.
* **SSO / deployment protection.** `ssoProtection` IS enabled at
  `all_except_custom_domains` and the project has no custom domain, so this was
  a reasonable read — but the primary production alias is exempt in practice.
  `claude-talentrah.vercel.app/` serves the app (200) and
  `/api/admin/charge-campaigns` returns the app's OWN
  `401 {"error":"Unauthorized"}`, while the two team-scoped aliases 302 to
  `vercel.com/sso-api`. Crons hit the exempt one.
* **RETRACTED: "zero runtime log entries in 24h".** Worthless as evidence.
  **Hobby runtime log retention is ONE HOUR** — the Logs timeline offers only
  "Last 30 minutes" and "Last hour", with "Last 12 hours" and "Last day" gated
  behind Pro. Cron-hour logs were never retrievable. This was presented as
  supporting evidence and should not have been.

### Where cron history actually lives on this plan

Not in Logs. **Observability → Cron Jobs** (`/observability/cron-jobs`) keeps
invocation counts and status classes for 12 hours, and each route drills into
per-route external-API calls. That is the only view on Hobby that answers "did
this cron run and what happened", and it is worth going to first next time.

### What did come out of it

[PR #59](https://github.com/Bayo-1987/Claude-Talentrah/pull/59) — `ingestAllSources` catches per source and records the reason in
`results[].error`, correctly, so one dead board cannot stop the others. But the
reason travelled only in a **200 response body**, and nothing reads a body:
Vercel records the status code, so a run where EVERY source failed was
indistinguishable from a quiet day. Same shape as the four cleanup bugs found
the same day — resolves without throwing, result never checked, failure reads as
success. Nothing had gone wrong; the route simply could not have told us either
way, which is why this took a dashboard rather than a log line. Total failure now
answers 500, partial stays 200.

### The lesson worth keeping

The repo's standard is to verify against live state. That was followed — and
still produced a confident wrong answer, because **the instrument was
misunderstood rather than the state misread**. A column that is overwritten in
place cannot answer a question about history, however carefully it is queried.
Before treating a measurement as evidence, check that it can distinguish the two
outcomes being tested: `last_checked_at` looks identical whether the 05:00 cron
ran and was overwritten, or never ran at all.

---

## Merged 2026-08-26 — PR #58, every listUsers() reads all pages (and #53 was under-fixed)

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#58](https://github.com/Bayo-1987/Claude-Talentrah/pull/58) | `fix/tracker-teardown-uses-cascade` | 13:23:54 | `a8ce5d2` |

**This entry exists because PR #53's entry above overstates what was done.** That
verification was genuine, but its SCOPE was not: it fixed the one unpaginated
`listUsers()` it was handed and never asked what else called it the same way.
Four more did. The repo's own stated habit — *after fixing a policy, ask what
else grants the same privilege* — was applied to RLS policies this session and
not to this.

`listUsers()` with no arguments returns only the first page (GoTrue default 50,
newest-first). The four survivors failed in two distinct ways:

* **Three cleanup hooks** (rate-limit, spend-race, referrals) swept by email
  prefix and silently left behind whatever had fallen past page one. Older
  accounts sort last, so the survivors are exactly the accounts accumulating
  longest — the hook looked like it worked while preserving the rows it existed
  to delete.
* **One find-or-create**, `upsert-base-resume`, was the seed bug verbatim: miss
  the account past page one, call `createUser`, get *"A user with this email
  address has already been registered"*. That is the failure that took main's CI
  down and was mistaken for contention. It was waiting for the account count to
  cross the boundary.

Now one shared `tests/support/list-users.ts` (`listAllUsers`,
`listUsersWithPrefix`, `findUserByEmail`), terminating on a SHORT PAGE rather
than a total, because GoTrue does not reliably return one.

### Three defects in this session's own PR #54, found by reviewing it against #55

1. **A comment was false.** It said deleting the org cascades any posting the
   line above missed. It does not — `job_postings` is NO ACTION, the entire
   finding #55 rests on. A false comment is worse than none: the next reader
   stops checking.
2. **Both deletes were unchecked**, so failure was invisible. It worked only
   because `afterEach` happens to clear applications first. `deleteOrgsCascade`
   throws, so **the suite passing is now itself evidence the teardown ran** —
   something the unchecked version could never give.
3. **`Tracker Fixture Co` / `trkfix-%.example` was registered with none of
   `fixture-orgs.ts`'s pattern lists**, whose header warns that a pattern added
   to one and not the others is how residue starts accumulating. Only the
   per-suite teardown removed it — the part that does not run when a process is
   killed, which is the whole reason the sweep exists.

### Verified, four-point standard

1. **PR API** — `merged: true`, `merged_at 2026-08-26T13:23:54Z`,
   `merge_commit_sha a8ce5d2996eede6d7b447f38d99400a4f2dd2715`.
2. **Fresh shallow clone of `main`** — parents `5719299` + `cae95e0`.
   `list-users.ts` present with its three exports; `git grep "listUsers()"`
   matches **only comment text** in four places, all of which explain the bug;
   both fixture patterns registered at `fixture-orgs.ts:15` and `:23`.
3. **Live probe** — not applicable: nothing here is reachable from production.
   Recorded as not-applicable rather than silently skipped.
4. **CI green on the merged head** — 5/5.

### A false alarm worth recording

The first run failed with seven tracker failures and
`Key (user_id)=… is not present in table "profiles"`. Two wrong causes were
suspected before checking: #55's new sweep deleting the fixture (it matched no
pattern — which was itself a real bug, fixed here), and this branch's widened
`trk-` sweep (delete order unchanged). What settled it in one command was
`main`'s own history: run `32971144631` failed at 12:57 with the same tracker
test plus referrals, and the next main run passed on identical code. Both runs
carry the Supabase Auth `Request rate limit reached` signature CLAUDE.md
documents as not a real failure. After a cooldown the run passed unchanged.

The cheap check was available first. It was reached for last.

### PR #57 confirmed working in real CI

This PR's run is the first under the new concurrency, and the wait step engaged:

```
##[notice]Shared-Supabase lock acquired after 0s (run #192).
```

---

## Merged 2026-08-26 — PR #57, a PR could carry no CI and still be mergeable

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#57](https://github.com/Bayo-1987/Claude-Talentrah/pull/57) | `fix/ci-never-lose-a-run` | 13:01:30 | `53286ee` |

**Read this before trusting any "CI green" claim written above it.** For most of
this session that evidence was weaker than it looked.

`ci.yml` used `concurrency: { group: talentrah-shared-supabase,
cancel-in-progress: false }`. The *reasoning* was right and is preserved — what
runs contend over is the one shared Supabase project, not git history. The
*mechanism* was not: GitHub keeps only ONE pending run per concurrency group
and cancels the rest, and never re-creates them. With one group across every
ref, a PR's queued run is discarded the moment anything else queues behind it.

Observed three times in one afternoon: #53's first run (`32963733680`) cancelled
after 1m14s when a push to main queued behind it; #51 initially showed no run at
all; #50 carries a `cancelled` run.

The failure mode is worse than a lost run. `gh pr checks` then lists only the
Vercel entries, all of which pass, so **the PR reads green and is mergeable with
no CI having run**.

The fix keeps `cancel-in-progress: false` — killing a run mid-suite leaves
debris, which was the original and still-correct argument — and scopes the group
per-ref. Cross-ref serialisation moves to
`.github/scripts/wait-for-ci-lock.sh`, which BLOCKS instead of discarding. It
cannot deadlock: a run only waits for strictly LOWER run numbers, so the oldest
waits for nobody. It waits for whole runs to complete rather than the matching
job, because `checks` and `e2e` both touch the database and `e2e` follows
`checks`. It gives up after 25 minutes rather than letting one hung run take CI
down. Only `checks` waits; `secrets` is DB-free and should keep reporting fast.

Verified against the live API, both paths: acquire (`lock acquired after 0s`)
and block (correctly listing runs 185 and 181 as unfinished).

`workflow_dispatch` is not available for recovering a discarded run — the token
answers `403 Resource not accessible by personal access token`. The manual
workaround is an empty commit.

---

## Merged 2026-08-26 — PR #55, test teardown that never worked

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#55](https://github.com/Bayo-1987/Claude-Talentrah/pull/55) | `fix/test-org-teardown` | 12:54:39 | `61fbce7` |

Test organisations had been accumulating in production. **Two diagnoses were
tested and rejected before the real one**, and both rejections were measured
rather than argued:

* *Auth rate limiting during cleanup* — replaying the exact `Promise.all` burst
  against 48 leaked accounts deleted all 48, zero failures.
* *Broken `afterAll` hooks* — counted accounts, ran a suite, counted again:
  34 before, 34 after.

The actual cause: of the six FKs pointing at `organizations`, four CASCADE and
**two do not** — `job_postings_organization_id_fkey` and
`payment_transactions_organization_id_fkey` are `NO ACTION`. Nearly every suite
that creates an org also creates a posting, so `organizations.delete()` is
refused `23503`; supabase-js **resolves rather than throws**, so an unchecked
`await` swallows it whole. The hook reported success and the org survived.
Measured mid-diagnosis: 20 `Campaign Co %` orgs present, 22 of 23 orgs carrying
a posting.

Deliberately NOT fixed by adding cascades. `NO ACTION` is correct for
production — deleting an organisation must not silently vaporise live job
postings.

**Two sessions built this concurrently.** This session's #56 and the other's #55
found the same root cause independently. #56 was closed: #55 maps the *second*
level of the FK graph (`job_postings` itself has NO ACTION children —
`applications`, `job_tailoring_requests`), which #56's helper did not handle and
would have failed on. #55 had already adopted #56's age gate, and #56's
`deleteTestUsers` reporting fix was ported across, so nothing was lost.

### Verified, four-point standard

1. **PR API** — `merged: true`, `merged_at 2026-08-26T12:54:39Z`,
   `merge_commit_sha 61fbce7250ab04287694a4912a149666ebfd8c1d`.
2. **Fresh shallow clone of `main`** — parents `a2bb980` + `f87858f`. All six
   support files present; the ported `deleteTestUsers` reporting confirmed in
   the merged `tests/support/auth.ts`.
3. **Live probe** — the leaked rows are gone: `Campaign Co %` orgs and their
   `Campaign Role %` postings cleared, and the campaign suite now finishes
   **net zero** where it previously finished +20.
4. **CI green on the merged head** — 5/5.

### Follow-up it needed

`fixture-orgs.ts` warns that its three consumers must agree on the patterns.
PR #54's `Tracker Fixture Co` / `trkfix-%.example` fixture was registered with
none of them, so the sweep would never have backstopped it — the per-suite
teardown alone, which is exactly the part that does not run when a process is
killed. Fixed in #58.

---

## Merged 2026-08-26 — PR #54, ad wallet top-up (0049 + 0050)

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#54](https://github.com/Bayo-1987/Claude-Talentrah/pull/54) | `feat/ad-wallet-topup` | 12:35:07 | `8791a6b` |

The last real gap in the billing loop. `credit_ad_wallet` had existed since 0046
with nothing employer-facing calling it, so wallets could only be funded
server-side.

**The whole design is one string.** `credit_ad_wallet` dedupes on
`ad_wallet_ledger_topup_reference_idx`, UNIQUE on `paystack_reference`
**WHERE paystack_reference IS NOT NULL** — a *partial* index. It protects
nothing unless the same reference reaches Paystack, the `payment_transactions`
row, and `credit_ad_wallet`. So the reference is minted once in the Server
Action before anything is charged and passed through unchanged.

That matters more than it looks. `fulfillPayment`'s "already processed" guard is
a **read-then-act** check on `payment_transactions.status`, and its own comment
records the webhook/callback double-grant race as open and out of scope. The
race is ordinary: the Paystack webhook and the new callback page both fulfil the
same reference. For credit packs and passes nothing closes it. **For a top-up
this index is the only defence.**

Two ways to defeat it, both closed and both tested:

| Defeat | Why it works | Closed by |
|---|---|---|
| A **null** reference | The index is partial — null collides with nothing, not even another null | 0050 CHECKs a top-up row carries a reference and an org |
| A **fresh** reference at fulfilment | Reads as entirely correct | Reference minted once and threaded through |

Proved the tests catch the second: minting a new reference per delivery fails
with `expected 125000 to be 25000` — a 5× overcredit. There is also a test
asserting the **broken null behaviour on purpose**, so that if anyone later
makes the index total, the failing test explains what the CHECK was buying.

### Verified, four-point standard

1. **PR API** — `merged: true`, `merged_at 2026-08-26T12:35:07Z`,
   `merge_commit_sha 8791a6b87665460c6e3d907ee57617b500622cc1`.
2. **Fresh shallow clone of `main`** — merge commit `8791a6b`, parents `614c64c`
   + `ae5cd51`. Both migrations, the action, the form and the callback page all
   present. The chain checked in the *merged* files rather than the diff:
   reference minted at `wallet-actions.ts:68`, stored at `:86`, sent to Paystack
   at `:98`, read back at `fulfill.ts:145` as `transaction.paystack_reference`.
3. **Live probe** — production routes answer (`/employer/campaigns/topup-callback`
   307 like every other gated employer route, `/` 200), and the schema is as
   intended:
   ```
   enum has ad_wallet_topup        -> 1
   checks on payment_transactions  -> payment_transactions_product_id_required,
                                      payment_transactions_topup_shape
   topup idempotency index         -> UNIQUE … (paystack_reference)
                                      WHERE (paystack_reference IS NOT NULL)
   product_id nullable now         -> YES
   ```
   Constraint *behaviour* was proved before the code was built on it, all four
   cases: null reference rejected, null organisation rejected, `credit_pack`
   still requires `product_id`, well-formed top-up accepted.
4. **CI green on the merged head** — 5/5.

### A cross-suite fixture bug this PR surfaced

CI failed first on a test this PR does not touch:

```
FAIL tests/tracker/tracker-and-farah.test.ts
     > an entry whose posting is later closed still renders its data
AssertionError: expected undefined to be 'Campaign Role 74d6c2'
```

`Campaign Role …` is the **ad-campaigns** suite's naming. Two tracker tests took
whatever `job_postings` returned first for `status = open AND source_type =
internal` — no ordering, no ownership, no creation. With 21 files in parallel
against one production database, the row they land on can belong to a suite
about to delete it, which is what happened.

Not caused by this PR, but made much likelier by #49 and #51, which added many
campaign tests each minting exactly the kind of row that fixture grabs.

Fixing it exposed a **second** hidden dependency: once the tests owned their
posting they still failed identically, because the fixture org was
`verified: false`. 0027 gates the authenticated SELECT on `job_postings` behind
`organizations.verified`, so an unverified org's postings are invisible to a
normal session and the embedded join returns nothing. The borrowed row happened
to belong to a verified org. Same symptom, entirely different cause — which is
what a borrowed fixture is good at hiding.

### Process note

An uncommitted working tree was destroyed mid-PR by a `git reset --hard` while
switching branches. The untracked migrations survived but had **already been
applied to production**, so the database was briefly ahead of the repo. Restored
and committed immediately. No production impact; recorded because "the DB is
ahead of the repo" is exactly the state that is hard to notice later.

---

## Merged 2026-08-26 — PR #53, the seed's user lookup reads every page

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#53](https://github.com/Bayo-1987/Claude-Talentrah/pull/53) | `fix/seed-user-lookup-pagination` | 12:04:51 | `99ebf40` |

`main`'s CI failed on PR #50's merge commit at *Seed demo data* with
`AuthApiError: A user with this email address has already been registered`, and
the next push passed on identical code. That reads like contention on the
shared project. It was not.

Both lookups called `listUsers()` **with no arguments**, so they searched only
the first page — GoTrue's default is 50 — with a plain `.find()`. The seeded
accounts are the OLDEST rows and GoTrue pages newest-first, so they sort LAST.
Measured at the time:

```
listUsers() with no args returned: 47 users
position of demo in the page: 47 of 47
```

Three accounts from the cliff. Not a race — **a paging bug with a countdown on
it**, which is exactly why identical code failed once and passed once.

### Verified, four-point standard

1. **PR API** — `merged: true`, `merged_at 2026-08-26T12:04:51Z`,
   `merge_commit_sha 99ebf401e191169ac05178e63e8f73351f6f3d28`.
2. **Fresh shallow clone of `main`**, reading the merged file itself rather
   than trusting the diff — merge commit `99ebf40`, parents `fb7d8b1` +
   `6ca4584`. `findUserByEmail` present at `scripts/seed.ts:201`; both call
   sites converted (`:223` demo, `:543` referred friends); the only surviving
   `listUsers` call is the paginated one at `:207` — the two other textual
   matches are the explanatory comment, checked rather than assumed.
3. **Live re-measurement**, which is the only live check this change admits:
   ```
   auth users on default page: 48
   demo position: 48 of 48
   merged helper @perPage=5:   demo found on page 10
   merged helper @perPage=50:  demo found on page 1
   merged helper @perPage=200: demo found on page 1
   ```
   Page 10 at `perPage=5` is the point: the old code read page 1 and stopped.
4. **CI green on the merged head** — 5/5.

### Two unrelated fixes carried, both of which were blocking

**A 1-in-43 flake.** This PR's CI failed on a referral test it does not touch:
`is case-SENSITIVE — a lowercased code silently attributes nothing`.
`generate_referral_code` is `upper(substr(md5(...), 1, 8))`; md5 hex draws from
`0-9a-f`, so **ten of sixteen characters are digits**. An all-digit code makes
`toLowerCase()` a no-op, the lookup correctly attributes, and the test fails
claiming a case-insensitivity that does not exist. Measured against the live
function over 50,000 samples:

```
all-digit codes: 1,162 / 50,000 = 2.324%
predicted (10/16)^8             = 2.328%   -> 1 run in 43
```

Fixed by pinning the referrer's code to a provably case-different value, with
an assertion that the pin worked. Confirmed the fix addresses the cause: pinning
to an all-digit code instead reproduces the failure through the new guard
(`expected '40900038' not to be '40900038'`).

**eslint now ignores `.claude/worktrees/**`.** Agent worktrees are git-excluded
but not eslint-excluded, so a nested checkout is linted with the wrong relative
paths, the `e2e/fixtures/**` rules-of-hooks override stops matching, and a clean
tree reports errors CI never sees in files nobody touched.

---

## Standing CI defect found 2026-08-26 — a PR can have NO CI and still be mergeable

**FIXED by [PR #57](https://github.com/Bayo-1987/Claude-Talentrah/pull/57)** (merged 13:01:30, `53286ee`) — see that entry above. Left here in full
because it explains why any "CI green" claim recorded EARLIER in this session
is weaker evidence than it appears.

`ci.yml` uses `concurrency: { group: talentrah-shared-supabase,
cancel-in-progress: false }` — a constant key, correct in intent, since what
runs contend over is the one shared Supabase project rather than git history.
But GitHub keeps only the **newest pending run** in a concurrency group and
cancels the others, and it does not re-create them. So a PR's queued run is
discarded whenever anything else queues behind it, and **no check ever reports**.

Observed three times today:
- PR #53's first run (`32963733680`) cancelled after 1m14s when a push to main
  queued behind it; the PR sat with only Vercel's checks and was mergeable.
- PR #51 initially showed no CI run at all, same cause.
- PR #50 has a `cancelled` run in its history for the same reason.

The recovery used was an empty commit. `workflow_dispatch` is **not** available
— the token returns `403 Resource not accessible by personal access token`.

Why it matters: `gh pr checks` on such a PR lists only the Vercel entries and
every one of them passes, so the PR looks green. Anyone merging on that signal
merges untested code. A real fix probably means replacing GitHub's
`concurrency` with a queueing mutex that waits rather than discards, since
discarding is inherent to how `concurrency` resolves pending runs.

---

## Merged 2026-08-26 — PR #51, the daily charge finally has a caller

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#51](https://github.com/Bayo-1987/Claude-Talentrah/pull/51) | `feat/ad-campaign-daily-charge` | 11:30:09 | `2607fd9` |

Closes the money defect recorded under PR #50. `charge_ad_campaign_day` shipped
in 0047 with three passing tests and **no caller**; `resume_ad_campaign` charged
the day it activated a campaign and nothing charged it again, so an employer
paid one day's rate for a thirty-day run. A tested function nobody calls is
indistinguishable from a missing one, and scores better in a coverage report.

Now: `runCampaignChargeJob` in `src/lib/billing/campaign-charges.ts`,
`/api/admin/charge-campaigns` (cron GET + admin POST), scheduled **08:00 UTC**
— after the 05:00 job ingest, so a campaign whose job closed that morning is
not billed for a day promoting a dead role.

**Two PRs were built for this, and the other one was closed.** The chip task
and this session produced #51 and #52 independently, converging on the same
design. #52 was closed because #51 is better on three counts: it paginates the
work-list with a keyset (#52's bare `select().eq("status","active")` silently
truncates at PostgREST's max rows — the same silent-undercharge class the PR
exists to fix); it carries an `ok` flag so a failed run answers 500 and a
scheduler alerts, where #52 always returned 200; and it has four error-path
tests #52 lacked. One test was ported across from #52 — the day boundary, below.

### Verified, four-point standard

1. **PR API** — `merged: true`, `merged_at 2026-08-26T11:30:09Z`,
   `merge_commit_sha 2607fd9c5634381517d49aa2c644fb74da6041f4`.
2. **Fresh shallow clone of `main`** — merge commit `2607fd9`, two parents
   (`7963f1a` + `384db70`). `campaign-charges.ts`, the route and
   `campaign-charge-errors.test.ts` all present; `vercel.json` carries
   `/api/admin/charge-campaigns` at `0 8 * * *`; the ported day-boundary test
   is on `main`; the billing plan's §9 landed.
3. **Live probe** — the most side-effecting route in the app, all three ways in:
   ```
   GET  no credential   -> 401 {"error":"Unauthorized"}
   GET  wrong bearer    -> 401 {"error":"Unauthorized"}
   POST wrong secret    -> 401 {"error":"Unauthorized"}
   ```
4. **CI green on the merged head** — 5/5.

### Both halves of idempotency are pinned

The duplicate-delivery test proves the **same** day is not charged twice. The
ported test proves the **next** day is. That second half is the one that fails
silently: a work-list filter excluding an already-charged campaign too eagerly
looks identical to a correct one on any single day's run, and only shows up as
a campaign that never bills again after day one — the original defect wearing a
different hat. Verified it catches that, by replacing the filter with
`.is("last_charged_on", null)`:

```
× MONEY: crossing the day boundary charges a second day, exactly once
  AssertionError: yesterday's campaign was not picked up the next day:
  expected +0 to be 1
```

68/68 across the three affected suites once restored.

### Rebase note

The branch went `CONFLICTING` when #50 and two doc commits landed under it. Two
conflicts, both resolved by **union rather than by choosing**:
`contract.test.ts`'s SPIES array keeps both sets of spies, and
`employer-billing-plan.md` keeps §8 "What was actually built" with this
branch's failure policy renumbered to §9. §8.5's "the daily charge cron is not
wired" is struck, since this branch is what wires it.

### Operational

Cron delivery is best-effort and never retried. A **duplicated** run is safe.
A **missed** run is not recovered — that day goes unbilled, in the employer's
favour. Same shape as 0043's renewal cron: load-bearing, no dunning queue, no
alert, so a cron that silently stops firing means campaigns run free again.

---

## Operational 2026-08-26 — production purged of 324 leaked test organisations

Not a merge. A **production data change**, recorded here because it is not
reconstructable from the git history and because it changes what the PR #51
cron will report on its first run.

### The finding

The premise investigated was "ad-campaigns.test.ts has no teardown". It has
one. So do the other six suites that create organisations. **None of them has
ever worked.**

```
afterAll(async () => {
  if (createdOrgs.length)
    await admin.from("organizations").delete().in("id", createdOrgs);
});
```

`job_postings.organization_id` is **NO ACTION, not CASCADE**, so Postgres
refuses the delete — and supabase-js reports that by *resolving* with
`{ data: null, error }` rather than throwing. The error was discarded at all
seven call sites. Reproduced against the live project before anything was
changed:

```
attempting delete of: Campaign Co 8bc26a91
error: { code: '23503',
         details: 'Key (id)=(b32bf622-…) is still referenced from
                   table "job_postings".' }
rows deleted: null
still present after delete? true
```

So the leak rate was **100% per run**, not intermittent — which is why the
count reached 324 organisations, 318 ad_campaigns, 192 ad_wallets and 385
ledger rows.

**Two mistakes, and the second is the one to remember.** Getting the FK order
wrong is ordinary. *Discarding the error* is what let it survive across seven
files for months. A teardown that fails loudly gets fixed the same afternoon;
one that fails silently fills a production database.

### Why it was urgent rather than untidy

117 of the leaked campaigns were `active`. PR #51's cron selects exactly that,
so its first scheduled run would have charged and paused 117 fixtures, and
every future run summary would have reported fake activity as real.

### State before and after, by SQL rather than by the script that did it

| | before | after |
|---|---|---|
| organizations | 326 | **2** |
| — fixtures | 324 | **0** |
| ad_campaigns | 318 | **0** |
| — `active` | 117 | **0** |
| ad_wallets | 192 | **0** |
| ad_wallet_ledger | 385 | **0** |

The two survivors are both real: **Zaria Digital** (`scripts/seed.ts`'s demo
org; the golden-path e2e runs against its postings) and **Fatishcakes** (a real
signed-up employer). Neither owned a single campaign or wallet, so **no real ad
data existed to lose** — checked before deleting, not asserted after.

### The guard that made the delete safe, proven rather than assumed

Selection is an **allowlist** of fixture patterns, so an organisation created by
a future feature is safe by default rather than safe by having been remembered.
On top of that a protected-name assertion aborts the whole run. Mutating the
pattern to the tempting shortening `%.example` gives:

```
ABORTED: fixture patterns matched protected organisations:
Zaria Digital (zariadigital.example)
```

Zaria's own domain is a `.example`, so "just match `.example`" was a real trap,
not a hypothetical one.

### One thing that went wrong, and the check that caught it

The first `--apply` pass deleted 315 of 324 and left 9. The script's closing
self-check refused to report success, which is what it is for. It now converges
over bounded passes, so a partial pass self-heals instead of depending on an
operator noticing. Re-running is a no-op.

### The fix needed two layers, and the first one alone was not enough

A per-suite teardown was the obvious answer and it is only half of one. Both
halves measured, on the branch, rather than reasoned about:

| configuration | leaked |
|---|---|
| `ad-campaigns.test.ts` alone | **0** — 23 organisations before, 23 after |
| 4 org-creating suites, 2 rate-limit failures, sweep disabled | **0** |
| full 33-file run, **all files reported passing** | **21** |
| full 33-file run, rate-limited | **42** |

The delete itself is proven correct at the exact shape and scale that leaks: 21
organisations each with a blocking `job_posting`, removed in 1.7s, 0 remaining
by direct SQL. And the leak is always a whole file's worth (20 orgs + 1
outsider = one run of ad-campaigns.test.ts), which says the hook did not
complete rather than that it deleted the wrong rows.

**What is NOT established is why it fails to complete at full parallelism.**
PostgREST row caps and `db_max_rows` were checked and ruled out. The runs that
would narrow it further are themselves rate-limited by the auth API this suite
hammers, so the question is open.

That unknown argues *for* the backstop, not against it. There is no staging
database; a teardown that silently does not run fills a production table, which
is exactly how 324 organisations accumulated. A sweep that runs once at the
end, unconditionally, does not need the mechanism explained to be correct.

So the fix is two layers:

1. **`deleteTestOrgs`** in each of the seven suites — deletes in FK order and
   **throws**, so a broken teardown fails the suite.
2. **`tests/support/global-teardown.ts`**, wired as vitest `globalSetup` —
   sweeps once after the whole run by a shared allowlist. A safety net, not the
   mechanism: a straggler on a *clean* run means a suite is missing layer 1, and
   the sweep says so loudly. It does not fail the run on finding residue (that
   is the case it exists for) but does fail if it cannot delete.

Proven by planting an organisation with a blocking `job_posting`:

```
[global-teardown] 1 fixture organisation(s) survived their suite's afterAll — sweeping.
[global-teardown] swept 1; 0 remaining.
```

### The sweep immediately found a leaker vitest cannot reach

`E2E Employer Co Vd9de0ad7`, from the **Playwright** suite.
`e2e/employer.spec.ts` had the identical bug a third time: delete postings by
title pattern, then organisations, both errors discarded. Its own comment
correctly noted that organisations do not cascade from their creator and missed
that `job_postings` is what refuses the delete. Now routed through
`deleteOrgsCascade`.

Fixture patterns now live in `tests/support/fixture-orgs.ts` so the three
consumers — per-suite teardown, global sweep, one-time script — cannot drift,
and the protected-name assertion guards all three rather than only the script.

### Follow-up, open not merged

All of the above is in **[PR #55](https://github.com/Bayo-1987/Claude-Talentrah/pull/55)**
(`fix/test-org-teardown`), together with `npm run cleanup-test-orgs`. Until it
merges, every interrupted suite run leaks again.

---

## Merged 2026-08-26 — PR #50, campaign Server Actions, UI and the review gate

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#50](https://github.com/Bayo-1987/Claude-Talentrah/pull/50) | `feat/ad-campaign-actions-ui` | 11:08:21 | `a55550c` |

0047/0048 gave campaigns a state machine nobody could reach. This is the layer
that reaches it: `/employer/campaigns` (list, create, edit, detail), the
lifecycle controls, and `/api/admin/moderate-campaign` for the §6.8 review gate.

**Where each check lives, and why there.**

| Operation | Client used | Reason |
|---|---|---|
| Create / edit draft | the **user's** client | RLS policies are the gate; a regression breaks creation loudly instead of being bypassed by a service-role write |
| Submit, pause, resume, review | service-role RPC | those functions are `service_role`-only and move money |
| Ownership, before any RPC | user's client re-read | the RPCs take a campaign id they cannot vouch for |

`requireSpendAuthority` is §7.4's owner/admin check. It is in the Server Action
layer because **that is the only layer holding a real session** — the money
functions take `p_actor_user_id` as an argument they cannot verify, so a role
check inside one would be checking a claim rather than a fact. It restricts
nobody today (`org_member_role` is exactly `owner, admin`) and its comment says
so, so it does not read as a live control. It exists as the seam a future
`viewer` role must not slip through by default.

Cross-org isolation is already pinned by `tests/billing/ad-campaigns.test.ts:328`.
That is what makes `assertCampaignBelongsToOrg` effective rather than
decorative, so it was not re-tested.

**Two deliberate refusals in the review route.** It does not accept a reviewer
id: the route authenticates with a shared secret, which proves *an* operator
and not *which* operator, so a caller-supplied id would make `reviewed_by` look
like attribution while being self-asserted — an honest null is visibly missing,
a wrong name is not. And a rejection without a note is refused, because the
employer cannot act on it and the next reviewer cannot tell what was wrong.

### Verified, four-point standard

1. **PR API** — `merged: true`, `merged_at 2026-08-26T11:08:21Z`,
   `merge_commit_sha a55550c559a56e5abb03830923ec9dff81314f6c`.
2. **Fresh shallow clone of `main`** — merge commit `a55550c`, two parents
   (`db79c8a` + `11aa528`). All six new source files present; `requireAdminSecret`
   appears 3× in the merged review route; both handlers registered in
   `contract.test.ts:167` and `:176`; `Ad Campaigns` in the masthead at
   `employer-masthead.tsx:33`.
3. **Live probe** against production:
   ```
   GET  /api/admin/moderate-campaign  (no credential)   -> 401 {"error":"Unauthorized"}
   POST /api/admin/moderate-campaign  (wrong secret)    -> 401 {"error":"Unauthorized"}
   GET  /employer/campaigns                             -> 307  (same as /jobs)
   GET  /employer/campaigns/new                         -> 307
   GET  /                                               -> 200
   ```
   The preview deployment could **not** be probed — Vercel SSO intercepts at
   `302 → vercel.com/sso-api` before the app runs, so nothing about the
   handlers was observable there. Recorded because a preview 302 is easy to
   mistake for a passing check.
4. **CI green on the merged head** — 5/5.

### The guard test was proved, not assumed

`tests/api/contract.test.ts` claims to cover every admin entry point, so both
handlers were added to it. Rather than trust that a passing test means a
working guard, the historical fail-open shape was reintroduced on the GET:

```
× moderate-campaign GET: 401 when no admin secret is configured
  AssertionError: OPEN ADMIN ROUTE: moderate-campaign GET answered 200
  with no secret configured and no credential presented
× moderate-campaign GET: 401 on a wrong credential
Tests  2 failed | 40 passed (42)
```

Restored: 42/42.

### Found while writing the docs, NOT fixed here

Checking the "still open" claims in `docs/employer-billing-plan.md` §8.5
against the code rather than asserting them turned up a live money defect.

`resume_ad_campaign` debits for the day it is called and sets `active`.
**Nothing charges it again.** `charge_ad_campaign_day` shipped in 0047 with
three passing tests and no caller — `grep -rn charge_ad_campaign_day src/`
matches only the generated type — and `vercel.json` declares three crons
(`renew-passes` 06:00, `ingest-scholarships` 07:00, `ingest-jobs` 05:00), none
of them this one.

Effect: **an employer pays one day's rate and advertises until their end date.**
Left out of this PR because scheduling a job that debits real wallets daily is
outward-facing and was not in the brief; it is the next piece of work, ahead of
the missing top-up UI, because that is a completeness gap and this is a
correctness one.

---

## Merged 2026-08-26 — PR #49, ad campaign schema and review gate (0047 + 0048)

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#49](https://github.com/Bayo-1987/Claude-Talentrah/pull/49) | `feat/ad-campaigns-schema` | 10:49:10 | `db79c8a` |

The second half of the employer billing surface: the wallet (0046) held money,
this holds the thing that spends it. Schema only — no UI in this PR.

**What it is.** `ad_campaigns`, an `ad_campaign_status` enum of seven states
(`draft, pending_review, rejected, active, paused_by_employer,
paused_insufficient_funds, completed`), a trigger enforcing the legal
transitions between them, and four SECURITY DEFINER functions:
`submit_ad_campaign_for_review`, `set_ad_campaign_review`,
`resume_ad_campaign`, `pause_ad_campaign`, plus `charge_ad_campaign_day` for
the daily cron.

**Two design calls worth keeping written down.**

*Daily rate, not CPC.* §6.8 says flat-rate first, CPC later. That is also the
only model that can be charged honestly right now: CPC needs deduplicated,
attributable click events, and this project has no such pipeline. Billing per
day charges for something the system can actually observe — that the campaign
was eligible to serve on a given date — rather than for a count it would be
guessing at. `last_charged_on` plus a unique index makes the daily charge
idempotent, so a cron that runs twice does not bill twice.

*Approval lands PAUSED, never ACTIVE.* An approved campaign moves to
`paused_by_employer`, and only `resume_ad_campaign` makes it live. This looks
like an extra click and is deliberate: approval is a statement about the ad's
content, and going live is a statement about money. Merging them would mean a
reviewer's click debits an employer's wallet — and would create a second path
from not-running to running, which is a second place to forget the charge.
There is exactly one, and it always charges.

**The defect this PR found in itself.** 0047 as first written permitted
`draft → pending_review` in the trigger but did not include `status` in the
column grant, so the branch was unreachable — the test failed with the row
still at `draft`. The fix (0048) resolved it toward the *stricter* side:
the trigger now rejects **every** client status write, and submission goes
through an RPC. Worth noting because the tempting fix was the other one —
adding `status` to the grant would have made the test pass and handed clients
the ability to write `active` directly.

### Verified, four-point standard

1. **PR API** — `merged: true`, `merged_at 2026-08-26T10:49:10Z`,
   `merge_commit_sha db79c8a8c62a99a09f54fa71ac52384d2be7435b`.
2. **Fresh shallow clone of `main`** — merge commit `db79c8a`, two parents
   (`15d36c0` + `68f0f6e`). `0047_ad_campaigns.sql`,
   `0048_ad_campaign_submit_for_review.sql` and `tests/billing/ad-campaigns.test.ts`
   all present in the clone.
3. **Live probe** against production, the part that actually matters:
   ```
   enum ad_campaign_status  -> draft,pending_review,rejected,active,
                               paused_by_employer,paused_insufficient_funds,completed
   functions present        -> charge_ad_campaign_day, pause_ad_campaign,
                               resume_ad_campaign, set_ad_campaign_review,
                               submit_ad_campaign_for_review
   trigger                  -> enforce_ad_campaign_transition
   authenticated UPDATE     -> daily_rate_ngn, ends_on, name, starts_on,
                               target_employment_type, target_locations,
                               target_seniority, total_budget_ngn, updated_at
   status writable?         -> no
   table-level UPDATE grant -> (none)
   RPC execute grants       -> postgres, service_role
   ```
   The column list is the check that counts: `spent_ngn`, `last_charged_on`,
   `reviewed_by`, `review_note`, `organization_id` and `job_posting_id` are all
   absent from it. A client can say what it wants to spend and cannot say what
   it has spent, cannot retarget a live campaign at a different job, and cannot
   approve itself. This is the 0026/0027/0028/0030/0041/0045 lesson applied
   before shipping rather than after — RLS policies do not restrict columns, so
   the grant is the control.
4. **CI green on the merged head** — 5/5 checks (typecheck/lint/unit,
   Playwright e2e, secret scan, Vercel build, preview comments).

**Not in this PR, deliberately.** The owner/admin spend check. It was raised as
a possible inconsistency with the wallet's and is not one: the wallet's
equivalent also lives in the Server Action layer, and this PR is schema-only.
It lands with the actions, which is the only layer holding a real session — a
role check inside a SECURITY DEFINER function would be checking an argument
the function cannot verify.

---

## Merged 2026-08-26 — PR #48, employer ad wallet (0046)

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#48](https://github.com/Bayo-1987/Claude-Talentrah/pull/48) | `feat/employer-billing-wallet` | 10:18:12 | `ce0df13` |

**First Phase 2 roadmap work after the defect sweep, and the first genuinely new
financial model in the codebase.** Design brief:
[docs/employer-billing-plan.md](docs/employer-billing-plan.md) — written and
reviewed *before* any code, deliberately.

### The race was reproduced before the schema existed

`spend_credits_atomic` (0035) exists because a read-then-write decrement looked
correct for months. The wallet is the same shape with bigger numbers, so the
naive JS implementation was built first and run against a throwaway wallet:

```
wallet ₦5000, two concurrent debits of ₦5000
  debits that SUCCEEDED: 2 of 2
  charged for: ₦10000   actually taken: ₦5000
  => RACE: ₦5000 served free
```

`debit_ad_wallet` does the affordability check and the decrement in **one
conditional UPDATE**. Swapping a naive body back in fails four tests — both
debits succeed at `balance == cost`, **10 of 10** get through a balance
affording 3, and a decrement is lost (19,000 where 16,000 is correct).

Worth recording: the *in-database* naive version needed a `pg_sleep` to race,
while the JS version raced immediately. The realistic failure mode is someone
writing the debit in TypeScript — which is exactly what 0035 was.

### Two deviations from the plan doc, both deliberate and documented

* **Whole naira, not kobo.** The brief proposed `balance_kobo bigint` for
  precision. `payment_transactions.amount` is `integer` in whole naira and so is
  `passes.price_ngn`; a second money unit alongside an existing one is a classic
  factor-of-100 bug generator. There is no sub-naira concept in the product.
* **The 20% low-balance threshold is a PLACEHOLDER.** The mechanism
  (percentage-of-last-top-up) is decided; the number is not. It originated as
  example text in the multiple-choice question used to pick the mechanism, was
  briefly attributed to the plan doc, then to the founder. **Neither was right —
  nobody has deliberated on 20%.** Recorded as provisional in both §7.3 and the
  migration, with the concrete risk stated: if a campaign costs a meaningful
  fraction of a typical top-up, 20% remaining may be less than one campaign, and
  a warning that arrives after the employer can no longer afford anything is not
  a warning.

### Two gaps found in this work's own tests

* **No cross-org read test.** The suite covered the write lockdown thoroughly
  and never asked who could *look*. `ad_wallets` is readable through an
  `is_org_member` policy, and a subtly wrong one leaks how much every competitor
  spends on ads. Proven by loosening the policy to `using (true)`: the outsider
  read `balance_ngn: 42000`. Includes a positive control so it cannot pass by
  denying everyone.
* The attribution drift on the threshold, above.

### Verified

1. **PR API** — `merged: true`, `merge_commit_sha ce0df13e11379e558d27a758bbc7955112a10f31`.
2. **Fresh shallow clone of `main`** — merge commit `ce0df13`, two parents
   (`2d5f4bd` + `5a0712a`). Migration, tests and plan doc present; the atomic
   `set balance_ngn = w.balance_ngn - p_amount_ngn` confirmed at
   `0046_ad_wallets.sql:158`; the PLACEHOLDER correction present in both the
   migration (2 places) and the plan doc.
3. **Live** — `ad_wallets` and `ad_wallet_ledger` both RLS-enabled, **2 policies
   and both are SELECT**, zero write policies, no table-wide UPDATE for
   `authenticated`, both RPCs present. 0 live wallets (nothing funded yet).
4. **CI** — 30/30 files, **368/368 tests**, Playwright 13/13; all four checks
   green.

### Open on this, for the record

* `admin` can spend the organisation's money (§7.4's accepted trade). Narrowing
  later is easy — the RPC already takes the actor.
* Credit-only refunds (§7.1) mean over-funding has **no remedy**, which makes
  the low-balance warning and pause-at-zero load-bearing rather than polish.
* Multi-rail is scoped for but not wired: v1 is Paystack NGN only. Diaspora
  billing stays blocked on §10's legal review.

---

## Merged 2026-08-26 — PR #47, empty fetch no longer wipes a source

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#47](https://github.com/Bayo-1987/Claude-Talentrah/pull/47) | `fix/empty-fetch-mass-close` | 09:29:25 | `23755c0` |

**Closes the one item the sweep's own write-up had flagged as STILL OPEN.** The
backlog is now genuinely clear — that line was written honestly a few hours
earlier rather than rounded into "done", and this is what closes it.

The freshness sweep closes "anything I did not just see", which means
*everything* when the fetch returned nothing. A board answering 200 with an
empty array — a deploy, a rate limit answered politely, a markup change —
closed every posting for that source. The next run reopens them, so the damage
is a window rather than permanent, but during it the feed is missing real jobs
and nothing said so.

Reproduced before fixing:

```
× THE BUG: zero jobs returned closes every open posting for the source
  AssertionError: FEED WIPED: expected [ 'closed', 'closed' ] to deeply equal
  [ 'open', 'open' ]
```

### The two design calls, written down

**The rule is "any", not a threshold.** Deliberately not "…but MANY open
postings exist". The two cases a threshold would separate — a source that
genuinely emptied and one that glitched — are not distinguishable from here:
both return zero, and the only difference is what we already hold. Withholding
closure when we hold one posting costs one stale listing until the next run; a
threshold to close it faster buys nothing and adds a number nobody can justify.
A source that is *supposed* to be empty has nothing open, takes the
`openBefore === 0` branch, and is a silent no-op rather than a warning.

**Silent skipping is not enough**, because `closed: 0` is also what a healthy
run looks like. `IngestSourceResult.closureSkipped`, a `console.warn` naming the
source and the count it protected, and a `⚠` line in seed output. The warning
says a *repeat* across runs means the source itself needs looking at — one skip
is routine, a persistent one is a broken source.

### A gap found in the work's own tests

The guard covers both closure paths — greenhouse/lever scoped by company,
schema-org scoped by source — but the first round of tests only exercised
schema-org. Testing one branch and assuming the other is the same assumption
this repo keeps getting caught by, so the company-scoped case was added and
proven to fail with the guard disabled. `tests/jobs/` 24/24 across 6 files.

### Stale references removed

`ingest.ts`'s comment pointed at `test-scenarios-job-feed-matching-prompt.md`,
which is not in this repo — a fair part of why the bug sat unfixed for months.
That and the two other comments pointing at missing brief files now reference
the code that demonstrates the behaviour instead. **No comment in `src/`,
`scripts/` or `docs/` points at a file that does not exist.**

### Verified

1. **PR API** — `merged: true`, `merge_commit_sha 23755c0e5ecf2855ea6cd333e10266e5fa337982`.
2. **Fresh shallow clone of `main`** — merge commit `23755c0`, two parents
   (`922615d` + `8a66bc4`). Guard confirmed in the merged `ingest.ts`
   (`closureSkipped`, the `openBefore` count, the skip warning); both test files
   present; no remaining `test-scenarios-` references.
3. **Live** — the feed the guard protects is intact: greenhouse 126 open / 11
   closed, `schema-org:workable-nigeria` 20 open / 0 closed. No schema change in
   this PR, so the live check is the data it defends.
4. **CI** — 29/29 files, **355/355 tests**, Playwright 13/13; all four checks
   green.

---

## The 2026-08-26 sweep — what it was actually about

Four items closed in one pass (#44 dedup, #45 org-domain, #46 name-guard, plus
0041 re-confirmed). Read as four tickets they look unrelated. They are not, and
the two things they share are the part worth carrying forward.

### 1. Verify against live data BEFORE designing the fix — it changed the answer twice

Not a process nicety. In two of the four it changed what got built:

* **#44 dedup.** Ranked highest on impact *on the assumption it was firing*.
  Measured: 127 postings, 127 distinct fingerprints, **0 dropped**, and no
  company under two sources. Real mechanism, no live instance. That reframed
  the deliverable from "fix an outage" to "make an invisible failure
  discoverable", and the ranking that drove the ordering of work was simply
  wrong.
* **#45 org-domain.** The brief offered two fixes and **both would have
  failed**. `Fatishcakes` claims `fatishcakes.com` from a **gmail.com**
  address, so it can never verify and holds the domain permanently. A bare
  `unique (domain)` would have locked the genuine employer out of *both* paths
  — create rejected by the index, join rejected because
  `joinOrganizationAction` gates on `verified` server-side — and made domain
  squatting a one-line attack. The naive fix was worse than the bug, and only
  the live row showed it.

The counter-case matters too: **#46 and #41 both checked clean** (no polluted
names in production; 0041's grants intact through four later migrations). The
check is cheap and worth running even when it confirms rather than overturns.

### 2. The recurring root cause is a Postgres grant the app layer forgot about

CLAUDE.md already names this — *"RLS row policies do not restrict columns"* —
and #45 and #46 are both fresh instances of it, from opposite directions:

* **#46** is the textbook case. `signUpSchema` validated names, but `0030`
  grants `update (first_name, last_name, …)` to `authenticated`, so a client
  PATCHes the column and **never executes the validation**. Confirmed live:
  U+200B, U+2060 and a plain space all wrote successfully. The Zod fix alone
  would have changed nothing for anyone not using the signup form.
* **#45** is the same lesson worn differently: `createOrganizationAction` had
  no uniqueness check *and* no constraint behind it, so nothing anywhere
  enforced one-org-per-domain.

The rule that keeps proving itself: **if a client holds a grant on a column,
application validation is UX, not a gate.** The gate has to be in the database
— a CHECK, a constraint, a column grant, or an atomic statement. Every fix in
this sweep that mattered put it there and left the app-layer check in place
only for the error message.

### 3. Two bugs found in the tooling, not the product

Worth their own line because both would have kept costing time:

* **The CI secret scanner reported its own download failure as a leak** (#43).
  Fixed and then *validated by contrast*: on #46 gitleaks genuinely ran and
  genuinely found a hardcoded test password. The two cases are now tellable
  apart from the message alone.
* **The `e2e/employer.spec.ts` flake was concurrent CI runs sharing one
  Supabase project** (#43), not the spec. Root-caused rather than patched.

---

## Merged 2026-08-26 — PR #46, names must render something visible (0045)

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#46](https://github.com/Bayo-1987/Claude-Talentrah/pull/46) | `fix/zero-width-name-guard` | 08:51:04 | `03dfdd3` |

**Correction to the brief:** `.trim()` *does* strip U+FEFF, so the BOM example
was already handled. The real offenders are U+200B/200C/200D, U+2060, U+180E —
category Cf, which the ECMAScript WhiteSpace production does not cover.

**Six call sites, three of which never trimmed at all** — `layout.tsx`'s avatar
initials and Farah greeting, and `renewals.ts`, which puts the blank straight
into a paying customer's renewal email. A literal space defeated those; zero
width was not even required.

**The JS/SQL drift was real, not hypothetical.** The rule is expressed twice
because a regex cannot cross the boundary, and the first version disagreed:
`has_visible_characters(U+FEFF)` returned TRUE while `hasVisibleName` returned
false — Postgres `\s` does not cover U+FEFF, JS `.trim()` does. That is the
SQL-accepts-what-JS-rejects direction, which puts the blank name back in the
table. Caught by running the same inputs through both rather than assuming they
agreed. The two character lists are **deliberately asymmetric**; the invariant
is identical accept/reject *behaviour*, asserted case by case.

**NULL allowed explicitly, not incidentally**, and the migration refuses to
apply while naming offending rows rather than letting `ALTER TABLE` fail bare.

### Verified

1. **PR API** — `merged: true`, `merge_commit_sha 03dfdd3c0fb3e96404f2f78130267edfbc7b06b3`.
2. **Fresh shallow clone of `main`** — merge commit `03dfdd3`, two parents
   (`e641cf7` + `0d5f2f7`). Migration, helper and test file present; the CHECK's
   `IS NULL` branches confirmed in the committed SQL; all six call sites
   confirmed routed through `visibleName`/`hasVisibleName`.
3. **Live, post-merge — both directions.** Happy path intact: `Adaeze Okonkwo`
   writes, greeting renders *"Ready to land your dream job, Adaeze?"*, initials
   `AO`, Farah `Adaeze`, renewal email *"Hi Adaeze,"*. `Ọlá`, `  Ada  `,
   `Jean-Luc`, `O'Brien` all accepted and display correctly. Rejection holds:
   U+200B, plain space and U+FEFF all `23514`. NULL still writable.
4. **CI** — 27/27 files, **349/349 tests**, Playwright 13/13; all four checks
   green on the PR head, and the secret scan verified as a genuine run
   (`1 commits scanned, no leaks found`) rather than a vacuous pass.

Proven by removal: dropping the constraint fails 9 tests, every invisible
character accepted exactly as in production.

---

## Confirm-only 2026-08-26 — premium-template gate (0041) still closed

Re-checked rather than re-diagnosed, per the brief. `0041`'s grants survive four
subsequent migrations: `resumes` has **no table-wide UPDATE** and only
`title, structured_content, source, updated_at` granted, so `template_id`
remains unwritable — the gate itself. Its regression suite passes **27/27**,
including `MONEY: cannot apply a premium template by writing template_id
directly`. The companion revokes on `farah_messages` and `referral_shares` are
also intact with no column grants.

One thing that looks alarming and is not: `resume_templates` still reports
`table_wide_update = true`. It has RLS enabled with a single `SELECT` policy and
**no write policy**, so the row policy refuses before the grant is consulted —
the inverse arrangement to `resumes`, established and pinned by tests in 0042.
Do not "fix" it.

---

## Merged 2026-08-26 — PR #45, one verified org per domain (0044)

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#45](https://github.com/Bayo-1987/Claude-Talentrah/pull/45) | `fix/duplicate-org-domains` | 08:11:37 | `f1df362` |

3 files, +234/−0.

**The case where checking live data before designing changed the outcome, not
just confirmed it.** The brief offered two fixes — a unique index on
`organizations(domain)`, or an app-layer check routing the second person to a
join flow. **Both, as stated, would have failed**, and production held the row
that proved it.

`Fatishcakes` claims `fatishcakes.com` and was created by a **gmail.com** user
(`zimcresttechnologies@gmail.com`, email confirmed). `evaluateDomainVerification`
requires the claimed domain to match the creator's own confirmed email domain,
so that org can never verify — it holds the domain permanently. Under a bare
`unique (domain)` the real employer at fatishcakes.com could neither **create**
(index rejects) nor **join** — because `joinOrganizationAction` gates on
`verified = true` **server-side**, not only in the onboarding page's joinable
query. Locked out on both paths, which is worse than the duplicate, and domain
squatting becomes a one-line attack: any free mailbox permanently denies a
company its registration.

**The rule that resolves it:** verification is what establishes a claim on a
domain — exactly what 0027 and 0028 exist for. A verified org owns its domain;
an unverified one owns nothing and blocks nobody.

`0044` is therefore a partial unique index:
`(lower(domain)) where domain is not null and verified`. Four cases, each pinned
by a test: two verified → rejected; verified alongside unverified → **allowed**
(the route past a squatter); two unverified → allowed; null domain →
unconstrained.

App layer does the other half, since an index alone surfaces as a raw Postgres
error rather than sending the person to their colleagues: a pre-check for a
verified org at the domain, and `23505` handled as a genuine race by **rolling
back** rather than leaving an unverified duplicate on the domain — that leftover
would be the exact debris the index prevents, and invisible to the joinable list.

### Verified

1. **PR API** — `merged: true`, `merge_commit_sha f1df36275bbc8abc9539e064387e4468c364c1af`.
2. **Fresh shallow clone of `main`** — merge commit `f1df362`, two parents
   (`550c0b3` + `27b36cc`). Migration present with the scoped predicate; the
   pre-check (actions.ts:120), the race handler (`23505`, :175) and
   `tests/employer/duplicate-domains.test.ts` all present.
3. **Live, post-merge** — `fatishcakes.com` still resolves to exactly **one** org
   (`Fatishcakes [verified=false]`), and the happy path is intact. Verified in a
   rolled-back transaction rather than by reasoning: a fresh domain creates then
   verifies successfully, and a **verified** org can still be created alongside
   the unverifiable squatter on `fatishcakes.com` — the anti-squatting route is
   open. Production re-checked afterwards: 2 orgs, zero probe leftovers.
4. **CI** — 26/26 files, **322/322 tests**, Playwright 13/13 on the PR head; all
   four checks green.

Proven first: `SPLIT COMPANY: two verified orgs share one domain` fails against
unfixed code.

---

## Merged 2026-08-26 — PR #44, dedup key collisions

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#44](https://github.com/Bayo-1987/Claude-Talentrah/pull/44) | `fix/dedup-key-collisions` | 07:54:46 | `feedd8a` |

4 files, +230/−7. Full write-up in `docs/phase-1-summary.md`; the short version
and the verification are here.

**A correction to my own ranking.** I put this top of the backlog on impact
partly assuming it was live. It was not: 127 postings, 127 distinct
fingerprints, 0 dropped, no company under two sources. Real mechanism, not an
active outage — worth saying because the ranking drove the ordering of work.

**The bug** is the key, not the hash. `company | title | location` is UNIQUE
table-wide, so two requisitions that canonicalize alike are one job. The batch
collapse was last-one-wins and discarded the losing posting's `external_url` —
the apply link — while `upserted` still reported a plausible count.

**The fix** disambiguates by URL instead of dropping, keyed stably. Cross-source
dedup is preserved and pinned by a test; it is the feature, and the obvious
"tighten the key" fix would have broken it.

### Verified

1. **PR API** — `merged: true`, `merge_commit_sha feedd8a987d73901f76af8ee8b3ddbac07b0a312`.
2. **Fresh shallow clone of `main`** — merge commit `feedd8a`, two parents
   (`80f870f` + `ad1e7b6`). `disambiguateFingerprint` (dedup.ts:49),
   `resolveFingerprintCollisions` and the `collided` counter (ingest.ts:29, :82,
   :167), and `tests/jobs/dedup-collisions.test.ts` all present.
3. **Live** — feed intact post-merge: 161 postings, **161 distinct
   fingerprints**, 150 open, 137 greenhouse + 20 schema-org. Every one of the
   157 external postings has a non-empty `external_url`; the only 4 without one
   are `source_type: internal`, which apply in-app and legitimately have none.
   Separately, a pre-merge churn probe over the live board returned **127
   updates, 0 inserts** — the change causes no row churn.
4. **CI green on the merge commit** — unit, Playwright and secret scan. On the
   PR head: 25/25 files, **317/317 tests**, Playwright 13/13.

---

## Merged 2026-08-25 — PR #43, CI serialized against the shared database

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#43](https://github.com/Bayo-1987/Claude-Talentrah/pull/43) | `fix/ci-serialize-shared-database` | 20:11:39 | `658565e` |

**The `e2e/employer.spec.ts` flake brief is CLOSED as root-caused, not patched.
The spec needed no change of its own** — the mechanism that broke it is gone.

`ci.yml` had no `concurrency:` block, so every push and every PR run started
immediately with nothing sequencing them, while all of them read and write the
one live Supabase project. Three separate failures in this run were that single
mechanism:

* `e2e/employer.spec.ts` on merge commit `5d65e0d` — a docs push started a
  second `main` run at 19:40:12 while the merge run (19:36:52–19:41:41) was
  mid-suite; the employer publish failed at 19:41:07 and the page never left
  `/employer/jobs/new`. **The identical tree passed Playwright minutes later**
  once nothing overlapped, which is what finally identified it as contention
  rather than a defect.
* Supabase Auth rate-limit exhaustion during the PR #42 review, which surfaces
  as unrelated assertion failures in other files rather than as a rate-limit
  error.
* The `hookTimeout: 60000` bump in `vitest.config.ts` — local runs competing
  with CI, every failure pinned at exactly the 10s hook budget.

**The group key is a constant, not `${{ github.ref }}`.** The usual idiom keys
on the ref so a branch queues only against itself; that models the wrong
resource. Contention here is over the Supabase project, not git history, so a
PR's run and a push to `main` must queue against *each other*. A per-ref key
would have prevented none of the three failures above — each involved two
different refs, or a local run versus CI.

**`cancel-in-progress: false`** — queue, never cancel. Killing a run mid-suite
skips the `afterAll`/`afterEach` cleanup, so its throwaway users, orgs and
job_postings survive; with no staging database that debris lands in the real
project and breaks the *next* run's fixtures. Cancelling does not save time, it
converts one slow run into a later failing one.

### Verified by demonstration, not by reading the docs

A second commit was pushed ~45s after the first to force contention:

```
20:00:21   c847a72a  pending       created=19:59:03   <- queued
           df0980fe  in_progress   created=19:58:17   <- running

20:04:35   df0980fe  completed/success   ended  20:04:08
           c847a72a  in_progress         started 20:04:11   <- 3s later
```

The three-second handoff is the proof. Under the previous config both would have
been executing against the same project from 19:59:03. That the queued run
*ran* rather than being superseded also confirms `cancel-in-progress: false` —
had it cancelled, `c847a72a` would have gone straight from `pending` to
`completed/cancelled`. Both finished green.

### A practical rule this earned

**Do not push to `main` while its CI is still running, and do not run the full
suite locally while CI is running.** The concurrency group now handles the
first case automatically; the second is still on the operator, because a local
`vitest` run is invisible to GitHub Actions.

### Note on PR #42's verification

The standard says "CI green on the merge commit". For #42 that was **not** met on
the merge commit itself — Playwright failed there, for the contention reason
above — but all checks were green on `main` HEAD (`490220c`) immediately after,
on the same tree. Recorded as "green at HEAD with one attributed failure on the
intermediate commit" rather than rounded up, since rounding it up would be false.

---

## Merged 2026-08-25 — PR #42, Paystack timeout / decline ambiguity (0043)

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#42](https://github.com/Bayo-1987/Claude-Talentrah/pull/42) | `fix/paystack-timeout-decline-ambiguity` | 19:36:49 | `5d65e0d` |

4 commits, 9 files, +1038/−66.

**The first entry in this run driven by financial-policy judgment rather than a
clear-cut defect.** 0041 was an unauthorized bypass; 0042's premium-template gap
was a product-integrity failure. Both had one right answer once the facts were
in. Here the *bug* was unambiguous but the *remedy* was not — three calls with
real trade-offs either way, recorded below so anyone changing one knows what was
weighed.

### The bug

`chargeOne` caught every failure from `chargeAuthorization` in one branch whose
comment asserted a single cause — "Paystack rejected the charge outright" — for
all of them. Timeout, DNS failure, reset connection, a 502 from Paystack's own
edge, and a genuine decline all reached `markLapsed`, which sets
`next_renewal_date = null`. The job selects on `next_renewal_date <= today`, so
that is what made it permanent: the Pass is never seen again, and the design
deliberately has no dunning. **One dropped connection ended a subscription the
customer was paying for.**

Proven before fixing, real job against the real database, only the Paystack
client mocked:

```
× a timeout leaves the Pass renewable and retries on the next run
  AssertionError: SUBSCRIPTION KILLED BY A NETWORK BLIP: a timeout lapsed a
  paying customer's Pass: expected 'lapsed' to be 'active'
```

Two corrections to the brief's framing: `markLapsed` does **not** clear
`authorization_code` (only `cancelPassAutoRenewal` does) — the token survived and
`next_renewal_date` was the casualty. But it was understated elsewhere: the run
also wrote `payment_transactions.status = 'failed'`, **a claim Talentrah cannot
support**, since a timeout can follow a successful debit. Those now record
`pending`.

### The three decisions

**1 — Three attempts.** One is what caused the bug. Unlimited leaves a Pass
promising a renewal that never comes, with no natural end. Three daily attempts
≈ three days of grace; Paystack incidents run minutes to hours, so beyond that
the failure is no longer plausibly transient. A judgment, not a derivation —
hence one exported constant (`MAX_INDETERMINATE_RENEWAL_ATTEMPTS`) so changing
it is visible and deliberate.

**2 — Verify before re-charging.** The non-obvious risk in "just retry": a
timeout can occur *after* the card was debited, so a naive retry bills twice for
one period — worse than the original bug, which only withheld a service where
this takes money. An indeterminate attempt stores its reference; the next run
verifies it before charging, and if the verify is itself indeterminate the run
backs off rather than gamble.

**3 — Safe-by-default classification.** The predicate is `isDecline`, asking "do
we have positive evidence the card was refused?", not `isIndeterminate` asking
"does this look like a network problem?". Under the second phrasing an
unrecognised error falls through to cancelling the customer — the original bug in
a new shape. **This was not theoretical: the first implementation used that
phrasing and the timeout test still failed.** The fix was wrong in the exact
direction it was meant to correct, and only the test caught it.

Also recorded: on the final give-up the design cannot rule out having stopped
while a charge of unknown outcome is outstanding. `pending_renewal_reference` is
therefore deliberately **not** cleared, the transaction stays `pending`, and the
run reports `NEEDS RECONCILIATION` naming the reference. Tidying that away would
destroy the only thread back to a refund someone may be owed.

### Backlog item closed outright

All three `fetch` calls in `paystack/client.ts` now share one `paystackFetch`
with `AbortSignal.timeout(15_000)`. **These were the last untimed external calls
in the repo** — the "no external call anywhere sets a timeout" item is done, not
narrowed.

### Two bugs found in the work itself

* **A fixture that silently retargeted its assertions.** A raw
  `admin.auth.admin.createUser` per test lost to Supabase Auth's rate limit under
  full-suite load; when it threw, the module-level `userPassId` kept the previous
  test's value and assertions ran against the wrong Pass. Symptoms — "expected 1
  transaction, got 2", a missing retry reference, intermittent, passing in
  isolation — looked exactly like a product bug. **Third of this class in this
  run**, after PR #38's `afterAll` that leaked the accounts it existed to delete
  and PR #39 review's `ledgerFor` reporting a failed query as an empty result.
  Now uses the retrying helper in `tests/support/auth.ts`, one account per file
  instead of seven, and a sentinel so partial setup fails loudly.
* **The CI secret scanner cried wolf on itself.** gitleaks 403'd on download, the
  step exited non-zero, and a bare `if: failure()` printed *"A secret-shaped
  value was found in this change."* Untrue. Now scoped to the scan step, with
  retries, and a separate notice saying what matters when the tool cannot run:
  **nothing was scanned, so nothing was cleared** — a green PR is not evidence
  the change was checked. Independent of this PR, and worth its own line: a
  security check that cries wolf on its own infrastructure is one people learn to
  dismiss.

### Verified

1. **PR API** — `merged: true`, `merged_at 2026-08-25T19:36:49Z`,
   `merge_commit_sha 5d65e0d764a6a62ff79c943574a2af93cc05709d`.
2. **Fresh shallow clone of `main`** — merge commit `5d65e0d`, two parents
   (`0e9b3cc` + `5b59851`). Present and confirmed: `0043_renewal_indeterminate_failures.sql`
   with its three `add column`s and the index; `PaystackDeclineError` (client.ts:34),
   `PaystackUnavailableError` (:46), `isDecline` (:75) and `AbortSignal.timeout` (:99);
   `MAX_INDETERMINATE_RENEWAL_ATTEMPTS = 3` (renewals.ts:18); and the CI fix
   (`steps.scan.outcome`, "Tooling failure notice").
3. **Live schema** — all three columns exist with the right types
   (`renewal_attempt_count:integer NOT NULL`, `pending_renewal_reference:text`,
   `last_renewal_failure_at:timestamptz`) and the partial index is live:
   `CREATE INDEX user_passes_pending_renewal_idx ON public.user_passes USING btree (pending_renewal_reference) WHERE (pending_renewal_reference IS NOT NULL)`.
4. **CI green on the merge commit** — unit and Playwright. On the PR head:
   24/24 files, **310/310 tests**, Playwright 13/13.

> **This one could not be probed against real data, unlike #39–#41 — and that is
> a gap in evidence, not a step that was skipped.** Production currently holds
> **zero** `user_passes` rows (0 total, 0 with auto-renew active, 0 mid-retry), so
> there is no Pass to exercise the renewal path against. What was verified live is
> the schema; the behaviour is covered by 7 tests driving the real
> `runPassRenewalJob` against the real database with only the Paystack client
> mocked. **The first real Pass with auto-renew active is the first opportunity
> for an actual live probe** — worth taking at the next verification pass rather
> than assuming this is settled.

---

## Merged 2026-08-25 — PR #41, full template library (0042)

| PR | Branch | Merged at (UTC) | Merge SHA |
|----|--------|-----------------|-----------|
| [#41](https://github.com/Bayo-1987/Claude-Talentrah/pull/41) | `feat/full-template-library` | 18:48:15 | `e120fce` |

17 files, +1557/−20. Phase 2's full-template-library milestone.

### What the previous state was

**Choosing a template changed nothing you could see.** All seven
`resume_templates` rows differed only in `name`, `industry_category`,
`is_premium` and `unlock_cost_credits`. Every resume rendered through the single
`ResumeDocument` component — `resume-builder/preview/page.tsx` did not even
`select` `template_id`. The gallery was selling a label.

### The Portfolio Grid / Pipeline fix — a product-integrity defect, NOT a 0041-class exploit

Recorded separately and in different language on purpose, because the two are
different failure modes and the severity vocabulary should not be shared:

* **0041** was an **unauthorized bypass**. A user took something they had not
  paid for and were not entitled to, by writing a column the server never meant
  them to touch. A control failed. The wronged party was Talentrah.
* **This** is the inverse. Portfolio Grid and Pipeline were premium at 10
  credits and rendered the free layout. The unlock worked *exactly as designed*
  — credits were spent, `user_template_unlocks` was written, the entitlement was
  real and correctly recorded. What the user received was a template that was
  **contractually theirs but visually indistinguishable from free**. Nothing was
  bypassed and no control failed. The wronged party was the **user**, who paid
  for a difference that did not exist.

So it is **not** a security finding and does **not** belong in the
0028/0030/0031/0041 running count. It is a promise the product did not keep.
It was outside the brief's four-new-templates scope and was fixed anyway,
because shipping a milestone that leaves paid templates empty is not a
defensible place to stop. Surfaced by the registry test:

```
× every premium template renders something distinct from the free default
  AssertionError: PAID FOR NOTHING: these premium templates render exactly
  like the free default: expected [ …(2) ] to deeply equal []
```

That assertion has **no exemption list**, unlike the free-template one below.

### What shipped

- **`slug` as the join key** (`0042`) — `text not null unique`, backfilled for
  the original seven with fixed values, not a `slugify(name)`. The registry keys
  off `slug` and nothing else: `name` is editable catalog copy with no unique
  constraint, so keying on it means a rename silently unmaps a layout with no
  error anywhere; `id` is a per-environment uuid and could not be committed to
  source. The migration raises a clear exception if any row lacks a mapping,
  rather than failing later on the `not null` with no indication of which row.
- **A component-per-slug registry**, visual-only differentiation — layout,
  density and typography change per profession; the `StructuredResume` shape
  does not, so a resume renders unchanged under any template and switching stays
  a reversible choice rather than a data migration.
- **Four new templates** — Clinical (Healthcare), Statute (Legal), Critical Path
  (Project Management, Enhancv's most popular category), Public Record
  (Government & Public Sector, deliberately chosen as a large segment neither
  competitor targets and a fit for a Nigeria-first product). Categories taken
  from Resume-Now's and Enhancv's real taxonomies, deduped against the existing
  seven. Three of the four premium; the catalog was 5-of-7 free.
- **Two premium templates rebuilt** — Portfolio Grid, Pipeline, per the above.
- **Preview wired through** the `resume_templates(slug)` join. `edit/page.tsx`
  was checked and has only a link, no preview pane, so needed no change.

Catalog is now **11 templates across 11 industry categories**, one per category.

### Bounded and visible, not silent

Four *free* templates (Structured Admin, Product & Tech, Field Notes, Ledger)
still render as clean-professional — the brief's stated fallback behaviour.
Encoded as `KNOWN_UNSTYLED_FREE_SLUGS` with two enforced rules: **it may only
shrink**, and **nothing premium may appear in it**. Stale entries and entries
that gain a component also fail. A documented list that can only shrink is the
opposite of the undocumented allowlist this repo has been right to distrust.

### The 0041 guard did not collide — checked, not assumed

`resume_templates` is catalog data: RLS enabled, exactly one `SELECT` policy,
**no write policy at all**. A write is refused by the row policy before the
table-wide grant is ever consulted — the opposite arrangement to `resumes`,
where a permissive `FOR ALL` policy let the default grant through. `slug`
carries no trust, money or identity.

Reconfirmed **live, post-merge**, with a real authenticated session:

```
update {"is_premium":false}       -> no error (row policy matched 0 rows)
update {"unlock_cost_credits":0}  -> no error (row policy matched 0 rows)
update {"slug":"hijacked"}        -> no error (row policy matched 0 rows)
insert new catalog row            -> 42501 new row violates row-level security policy
re-read: slug=statute is_premium=true cost=10
=> UNCHANGED — RLS refused first
```

The silent zero-row updates are exactly why the re-read matters: a column-level
denial errors, a row-policy denial does not, and only re-reading with the
service role tells those apart from success. `column-privileges.test.ts` now
asserts this as a standing check (27 → included in the 303).

### Verified

1. **PR API** — `merged: true`, `merged_at 2026-08-25T18:48:15Z`,
   `merge_commit_sha e120fce5ba8f7df87727a39364a405b0ee19f666`.
2. **Fresh shallow clone of `main`** — merge commit `e120fce`, two parents
   (`99751a7` + `6720409`). `0042_template_slugs_and_library.sql` present with
   its statements; all six template components present
   (`clinical`, `statute`, `critical-path`, `public-record`, `portfolio-grid`,
   `pipeline`) plus `index.tsx`; `vitest.config.ts` glob confirmed widened to
   `["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"]`.
3. **Live production check** — all **11 rows have a non-null slug**; the four
   new rows match the migration exactly (Clinical/Healthcare/free/0,
   Statute/Legal/premium/10, Critical Path/Project Management/premium/10,
   Public Record/Government & Public Sector/premium/10); catalog unwritable as
   above.
4. **Premium render spot-check** — a real resume was created on the **Statute**
   template (premium, 10 credits) and the preview page's *exact* query run
   through a real RLS-scoped authenticated session against production returned
   `joined slug: statute`, which resolves to `StatuteTemplate`, **not** the free
   default. See the honest limit on this below.
5. **CI green** — 23/23 files, **303/303 tests** (up from 272: `template-registry`
   10, `template-rendering` 19), Playwright 13/13, all four checks on the PR head.

**Honest limit on point 4.** The chain query → joined slug → matched component
is verified against production *data* through a real session. What is *not*
verified is the deployed server rendering those pixels in a browser: the
`/auth/callback` route requires a PKCE `code` and calls
`exchangeCodeForSession`, so an admin-generated magic link cannot establish a
browser session through it — correct app behaviour, not a defect — and entering
a password is not something to do here. The route is confirmed deployed and
auth-gating (`307 → /login`), and CI's Playwright exercises the real app. State
it that way rather than claiming a production screenshot that was not taken.

### Two defects found in this work's own tests

- **The tests proved mapping, not rendering.** The registry suite asserted
  component *identity* — broken markup, a crash on an empty section, or a
  copy-paste rendering the same DOM as its neighbour would all have passed.
  `template-rendering.test.tsx` now renders each template with
  `react-dom/server` and asserts content survives, `EMPTY_RESUME` renders (what
  a user sees immediately after picking a template), no two produce identical
  markup, and two concrete layout claims. Proven non-vacuous by pointing
  `statute` at `ResumeDocument`, which fails with *"statute renders
  byte-identical markup to clean-professional"*.
- **`vitest.config.ts`'s glob excluded `.tsx`**, so that entire suite was never
  collected. An uncollected file is **not reported as skipped** — it looks
  exactly like a clean run, and the only tell was the test count not moving.
  Glob widened; confirmed no other `.tsx` test file existed, so nothing
  previously-failing was hidden by it.

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
3. ~~**Test-coverage briefs**~~ — **all closed.** The 2026-08-26 sweep took the
   five scoped to it (dedup, org-domain, premium-template, zero-width, employer
   flake), plus Paystack earlier and the empty-200 guard after. Kept below as
   the record of what each was and how it was closed:
   - ~~Cross-source dedup hash collisions destroying a posting's apply link~~
     — **done**, PR #44. Mechanism real but not firing; fixed and made
     discoverable via `IngestSourceResult.collided`.
   - ~~A transient empty-200 ingest response mass-closing a source's live
     postings~~ — **done**, PR #47. Was the last item outstanding; the guard
     refuses to close when a fetch is empty but open postings exist, on both
     the company-scoped and source-scoped paths, and reports the skip.
   - ~~A Paystack blip being indistinguishable from a real decline~~ — **done**,
     PR #42 / migration 0043. Also closed the "no external call anywhere sets a
     timeout" item outright: those were the last untimed calls in the repo.
   - ~~Duplicate org names/domains unguarded~~ — **done**, PR #45 / migration
     0044. Scoped to VERIFIED orgs only; a bare unique index would have locked
     real employers out behind unverifiable squatters.
   - ~~Premium-template gate bypassable via a direct `PATCH` to
     `resumes.template_id`~~ — **done**, PR #40 / migration 0041. Confirmed live
     and fixed; the sweep also found and fixed the Farah rate-limit bypass.
   - ~~A zero-width character defeating the "no name yet" guard~~ — **done**,
     PR #46 / migration 0045.
   - ~~`e2e/employer.spec.ts` flake~~ — **closed**, PR #43. Root-caused to
     concurrent CI runs sharing one Supabase project and fixed with a
     constant-key concurrency group; the spec itself needed no change.

Items already closed that these briefs still describe as open — confirm, don't
re-diagnose: the ingestion trigger's fail-open (#37), the `spendCredits` race
and the scholarship credit try/catch gap (#34), and the resume-builder
credit-spend race (#34).

---

## Next: employer billing (Phase 2)

No backlog items remain. The next piece of roadmap work is **employer billing**,
chosen over Ad Campaign Manager because it is the prerequisite — you cannot
charge for a campaign without it — and because the Paystack rails and
decline/indeterminate handling are freshly hardened and well understood after
PR #42.

A design brief exists at [docs/employer-billing-plan.md](docs/employer-billing-plan.md)
and is **a proposal, not a decision**. No code and no migrations have been
written. It covers: what is genuinely reusable from the Pass machinery versus
what only looks reusable (`runPassRenewalJob`'s fixed-price/fixed-date shape does
not map onto metered ad spend); an atomic wallet decrement modelled on
`spend_credits_atomic` from the first commit rather than hardened later; the
zero-balance policy (campaigns **pause**, they do not run negative and get
invoiced) with the reasoning written out; and rail-as-data so a top-up's rail is
a property of the transaction even though v1 wires only Paystack NGN.

Four questions in it need a founder answer before schema exists. The sharpest is
**refunds**: if an unspent balance must be withdrawable, that is payouts and KYC
— exactly what §6.7 avoided for referrals by choosing credits over cash.
