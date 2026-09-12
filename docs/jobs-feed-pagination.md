# Jobs feed pagination — Recent tab shipped, Recommended/External/Saved proposal

Follow-up to the egress investigation that found PR #200/migration `0086`
fixed per-row payload size but left `postingsQuery()` in
[jobs/page.tsx](../src/app/(app)/jobs/page.tsx) with no `.limit()`/`.range()`/
`.order()` at all — every open posting matching the current filters is still
fetched on every feed view. This is the follow-up: bound row count without
corrupting Recommended's ranking, which needs the whole filtered board in
memory to mean anything.

## Real numbers, measured today (2026-09-08), production (`nytwbbzfpytctjsoczzq`)

| | |
|---|---|
| All open postings | 673 |
| Open, within the feed's ambient 30-day freshness floor, unlisted excluded | 338 |
| Avg internal row size at FEED_COLUMNS width (Postgres `pg_column_size`) | ~1,621 bytes |
| Total row bytes for one default (no-filter) feed fetch | ~535 KB |
| `match_scores` rows total / distinct users | 1,883 / 7 |
| A real user's score coverage of today's 338-row board | 0, 0, 54, 54, 190, 198, 338 (out of 338) |

The 535 KB figure is Postgres's own internal row size, not wire bytes —
PostgREST's JSON serialization (repeating every field name per row) adds
real overhead on top, so actual transfer is higher. It is not re-measured
here because it doesn't change the conclusion either way: row count is
still the growing, unbounded variable, and everything below is sized off
that.

## Step 1 — Recent tab: shipped

`fix/jobs-feed-recent-pagination` branch, commit is the diff to review — real
DB-side pagination for the Recent tab specifically: `.order("posted_at",
{ascending: false}).order("id", {ascending: true}).range(from, to)`, 24 rows
per page, a `page` query param following the existing `tab`/`posted`/
`workType` convention, Prev/Next links modeled directly on
`scholarships/page.tsx`'s existing `buildPageHref` pattern (this codebase
already had exactly this precedent — page/PAGE_SIZE/`.range()`/`{count:
"exact"}`/Prev-Next hrefs — for the scholarships list).

**Filters untouched.** Status, the 30-day freshness floor, the 0107
unlisted-org exception, work type, and seniority are applied identically to
the paginated query — copied, not refactored, from `postingsQuery()` (see
"three copies, not shared" below for why).

**Three coupling issues found while implementing, not anticipated in the
original ask — fixed, not routed around:**

1. **The country-filter menu's per-country counts and the "all countries"
   total** (`countryMenuCounts`, `everyCountryCount`) are computed from the
   same full board fetch, for every tab including Recent. A naive
   `.range()` on `postingsQuery()` would have made those counts reflect only
   the current page, so the country menu would appear to change contents as
   someone paged through Recent. Fixed by adding a second, deliberately
   lightweight query (`boardAggregateQuery`, 6 columns instead of
   FEED_COLUMNS' ~20 — no description, no salary, no dates beyond what
   `deriveCountry` needs) that still reads the *whole* filtered board, used
   only for these aggregate counts and never for rendering. This is a net
   egress *reduction* even accounting for the extra round trip: fetching 338
   rows at ~6 lightweight columns costs far less than the single 338-row
   FEED_COLUMNS fetch it replaces for this path.

2. **The autocomplete search-suggestion index** (`search-suggestions.ts`)
   ships to the browser built from the *whole* board — its own file header
   says so explicitly, as the deliberate reason there's no debounce: "the
   feed already fetches every open posting — there is no pagination." That
   assumption is now false for Recent. Fixed the same way as (1): the index
   is built from `boardAggregateQuery`'s rows for the paginated case, so
   autocomplete keeps covering the whole board rather than just one page.
   This required narrowing `buildSuggestionIndex`'s and `skillsOf`'s
   parameter types from a near-full-row `Omit<>` to a `Pick<>` of the exact
   fields each function reads (`title`/`company_name`/`location`/
   `structured_jd`) — a strict loosening, so every existing caller still
   type-checks unchanged.

3. **The country filter itself is JS-only** — every tab today applies it as
   an in-memory `.filter()` over the fetched board, not a DB clause. Left
   that way for a `.range()`-paginated Recent tab, it silently breaks
   pagination: page 2 would continue the *unfiltered* board's next slice,
   filtered again in memory, so "Next" could skip real matches or repeat
   ones already shown depending on how they happen to interleave with
   non-matching rows in DB order — a correctness bug with no error and no
   visible sign, exactly the failure class this whole investigation started
   from. Fixed by reusing `countryOrFilter()` (`src/lib/jobs/country.ts`,
   already built for the public landing pages' equivalent DB-side count) to
   push the filter into the paginated query, but *only* once the lightweight
   board fetch confirms real matches clear `COUNTRY_THIN_THRESHOLD` — the
   decision has to be made before the query is built, not after, so it's
   pulled into its own small, unit-tested function
   (`src/lib/jobs/recent-pagination.ts`'s `decideCountryFilter`,
   `tests/jobs/recent-pagination.test.ts`).

**Explicit scope boundary, not fixed here:** Recent tab *with* a search term
keeps today's unbounded behavior. `search_job_postings` (the full-text RPC,
migration 0100) has no `LIMIT`/`OFFSET` parameters, and adding them is a
separate, small piece of work — the pagination added here only applies when
`tab === "recent" && !q`.

**A tradeoff worth naming rather than hiding:** the filter clauses (status,
freshness, unlisted-org, work type, seniority) now exist in three places —
`postingsQuery`, `boardAggregateQuery`, `paginatedRecentQuery` — instead of
one. This is deliberate, not an oversight: Supabase's `.select()` reads the
*literal type* of its argument (a fact this file's own `FEED_COLUMNS`
comment already documents, discovered when a `+`-concatenated select
silently widened to `GenericStringError`), so passing a column list as a
runtime parameter to one shared function isn't type-safe here without
reaching for generic query-builder types this codebase doesn't otherwise
use. The three are commented as required siblings; a future filter change
needs to touch all three.

**Before/after, measured (`explain analyze` against production, same
filters):** at today's board size, DB execution time is basically unchanged
— 1.26ms unbounded (338 rows) vs 1.68ms paginated (24 rows, adds a sort
step) — this repo's Postgres project is small enough that both are a
sequential scan either way, and honesty requires saying so rather than
claiming a latency win that isn't real yet. **The actual win today is row
count / bytes transferred**, not query time: 24 of 338 rows is a ~93%
reduction (24/338 ≈ 7%), matching the ~38 KB vs ~535 KB estimate above. The
protection this buys is against *future* growth — at 10,000 open postings
the unbounded query becomes the slow one and this one does not, which is
the actual failure mode PR #200 already fixed once (per-row size) and this
closes the other half of (row count).

## Step 2 — Recommended / External / Saved: investigated, not guessed at

**The question:** can `match_scores` support real `ORDER BY score DESC
LIMIT/OFFSET` pagination, with an honest fallback for postings that don't
have a score row yet?

**What's real, checked against production, not assumed:**

- `match_scores(id, user_id, job_posting_id, score, tier, explanation,
  computed_at)` — `score` is a plain `integer`, genuinely orderable in SQL.
- A unique index already exists on `(user_id, job_posting_id)` — a join
  against it is safe, one row per user per posting, no fan-out risk.
- **No index on `(user_id, score)`** — one would be needed for an efficient
  per-user `ORDER BY score DESC`; not a blocker, just a small addition if
  this gets built.
- **Coverage is the real problem, and it is not an edge case.** Measured
  against seven real users and today's 338-row default board: two users
  have match_scores for **zero** of the 338 postings; the rest range from
  16% to 100% coverage. Every one of those gaps is a posting `scoreJobs`
  has genuinely never scored for that user — not stale data, just never
  computed yet (a new posting since their last feed render, or a user who
  hasn't rendered the feed at all).

**Why that coverage gap rules out a straightforward join-and-paginate:** an
`INNER JOIN match_scores ... ORDER BY score DESC LIMIT N` silently drops
every unscored posting from the result — for the two users above, on
today's board, that's *all 338 of them*. A `LEFT JOIN` with unscored
postings sorted to the bottom (`COALESCE(score, 0)`) avoids dropping them,
but then a fresh posting or a first-time visitor's "Recommended" tab would
show whatever already has real scores first and everything genuinely new
or personally unscored last, indefinitely — not "best match", closer to
"already-known match, then everything else in undefined order." Making it
actually mean "best match" requires either (a) a background job that keeps
scores current for every active user as the board changes, independent of
any single feed render, or (b) computing scores for the unscored remainder
inline before the page can be sorted — which is `scoreJobs` needing the
full board in memory again, the exact problem this was meant to avoid.
Either is real, valuable work — neither is "add an `ORDER BY`."

**Conclusion: not safely achievable at this scope.** The honest scope for
`match_scores`-backed ranked pagination is closer to a background
scoring/refresh job than a query change, and deserves its own design pass
rather than being folded into an egress fix.

**Recommended interim step:** a hard ceiling on `scored.length` for
Recommended/External/Saved, applied *after* `scoreJobs` and the existing
sort — so it changes nothing about ranking correctness, it just stops the
rendered (and `after()`-persisted) set from growing without bound as the
board does. Suggest **2,000** (board is 338–673 today; this is pure
headroom, not a current-behavior change — verified: capping at 2,000 today
is a no-op, since the largest possible filtered set, 673, is already under
it). One line at the same spot the promoted-jobs reorder already runs, e.g.
`scored.length = Math.min(scored.length, RECOMMENDED_HARD_CAP)` — small
enough to be worth a one-line note in that block's own comment about why a
cap exists, rather than a new file. Worth flagging: this caps `scoreJobs`'s
input too if applied *before* scoring instead of after — the ceiling must
sit after scoring and after the sort, never before, or it becomes exactly
the "arbitrary wrong subset" bug this whole investigation exists to avoid.

**Not built without a go-ahead** — this is the proposal, not the diff. If
approved, it's a small, low-risk follow-up commit; real `match_scores`
pagination is separate, larger work to scope on its own.

**Update, since shipped:** the interim hard cap above was approved and
built (`RECOMMENDED_HARD_CAP = 2000` in `jobs/page.tsx`, applied after
scoring and after the sort exactly as specced) — this doc was never updated
to say so until now, which is itself worth naming: a proposal marked "not
built without a go-ahead" needs the same "come back and update this" habit
`phase-1-summary.md` already has, or it reads as still-open long after it
isn't.

## Step 3 — the background scoring-refresh job: built (send-latency-2, 2026-09-11)

Part of a broader latency review (see the review's own PR/report). This is
what Step 2's own conclusion called for: `runMatchScoreRefreshJob`
(`src/lib/matching/refresh-job.ts`), a daily cron
(`/api/admin/refresh-match-scores`, `vercel.json`), fills genuine
`match_scores` coverage gaps — (user, posting) pairs that have never been
scored — for every user with a base resume, against the same public,
verified-org, unlisted-aware eligible board every other discovery surface
enforces by hand (this job reads through the service-role client, which
bypasses RLS, so it re-implements the `organizations.verified` gate itself,
the same way `src/lib/digest/send.ts`'s `filterListablePostings` already has
to for the weekly digest — 0109's own finding, that nothing does this for a
service-role reader automatically, applies here too).

**What this does NOT do, on purpose:** it does not re-score a pair that
already has a row (a resume edit doesn't retroactively invalidate an old
score — a different, separate problem from the coverage gap this closes),
and it does NOT flip Recommended/External/Saved over to real `ORDER BY
score DESC LIMIT/OFFSET` pagination. Coverage has to be reliably high
*before* that cutover is safe, per this doc's own reasoning above — this
job is what gets coverage there; the query cutover is a later, separate
change once it demonstrably has.

**Why a plain per-user loop, not a set-based SQL function:** at today's real
scale (7 users with a base resume, a few hundred eligible postings) a
per-user loop costs a few thousand simple, indexed queries per run at
worst — nothing. Mirrors `sendJobMatchDigest`/`runMentorshipSweep`'s own
per-recipient cron shape rather than introducing a new migration/RPC for a
data volume that's trivial today. If `usersConsidered` or `eligiblePostings`
ever regularly approach their caps (500 / 2,000 — the second one is the
SAME number and reasoning as `RECOMMENDED_HARD_CAP` above, kept as a
separate constant per this doc's own "three copies, not shared" convention),
that's the real signal to revisit as a set-based query, not a bigger cap.

Real integration tests (`tests/matching/refresh-job.test.ts`) prove the gap
is filled for a real seeker, an unverified org's posting and an unlisted
(non-admin-approved) posting are never scored, a stale/closed posting is
excluded, a second run is a true no-op for an already-covered user (no
rewrite, `computed_at` untouched), and a partially-covered user only gets
their genuine gap filled — an existing row is never overwritten.

**Found, not fixed, while building this:** a real ambient user's base
resume has no `skills` field at all on `structured_content`, which crashes
`computeMatchScore` (`expandResumeSkills` iterates `resume.skills`
unconditionally) — reachable from the ORIGINAL feed/apply-time call sites
too, not something this job introduced. Flagged as its own follow-up rather
than fixed here (out of scope for a background-job design task); this
job's own per-user try/catch absorbs it correctly in the meantime (logged,
that one user's refresh is skipped, the run continues for everyone else).
**Fixed separately, immediately after** (`fix/resume-skills-crash`): both
unguarded call sites (`scoreJobs`, the one every signed-in user's `/jobs`
feed goes through directly with no try/catch, and
`computeAndStoreApplicationMatchScore`) turned out more exposed than "found,
not fixed" suggested — a resume in this exact shape crashed a user's whole
feed page, not just one score — so this got its own fix rather than an
indefinite deferral.

**Also found the hard way, after this shipped:** the eligible-board query's
`.limit(MAX_ELIGIBLE_POSTINGS)` had no `.order()` ahead of it, which is
non-deterministic once real row count passes the cap — broke `main`'s CI
directly (a just-inserted test fixture posting was silently excluded from
the page Postgres happened to return). The original claim that this class
of cross-suite contention "does not reproduce in CI" was wrong at the
granularity that matters: CI isolates each WORKFLOW JOB's own database, not
each test FILE within one job — every file in the `Typecheck, lint, unit
tests` job still shares one database in parallel with every other file.
Fixed by ordering newest-first before the limit, which is also the more
correct production behaviour (a cap should drop the stalest rows, not an
arbitrary scan-order slice) — see `refresh-job.ts`'s own header for the full
correction.
