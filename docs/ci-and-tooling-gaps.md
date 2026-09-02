# CI and tooling gaps

Operational facts about this repo's CI that cost real time and will cost it
again unless they are fixed at the source or written down. Each one has a
workaround, and each workaround has a side effect — which is the reason to
write them down rather than keep routing around them.

Entries 1–3 are from 2026-08-27. Entries 4–5 were added 2026-09-02 while
closing the flake ledger in [PR #191](https://github.com/Bayo-1987/Claude-Talentrah/pull/191) —
deliberately, so a flagged-but-unfixed finding lands here as a backlog item
with an owner and a next check, rather than as a line in a merged PR's prose
that the next session has no reason to go looking for.

---

## 1. The GitHub token cannot re-run a workflow

**Symptom.** `gh run rerun <id> --failed` and `gh workflow run CI --ref <branch>`
both answer:

```
HTTP 403: Resource not accessible by personal access token
```

**Diagnosis.** The token is a **fine-grained PAT** (`github_pat_…`), not a
classic one, so it carries repository *permissions* rather than OAuth *scopes* —
which is why `gh auth status` shows no scope list for it and the failure looks
like a mystery. The API says exactly what is missing, in a response header:

```
$ gh api -X POST repos/<owner>/<repo>/actions/runs/<id>/rerun-failed-jobs --include
HTTP/2.0 403 Forbidden
X-Accepted-Github-Permissions: actions=write
```

So the token currently has **Actions: Read** — enough to list runs and read
logs, both of which work — and needs **Actions: Read and write**.

**The fix** (account owner only; nobody else can change a PAT's permissions):
GitHub → Settings → Developer settings → Personal access tokens → Fine-grained
tokens → this token → Repository permissions → **Actions: Read and write** →
save. No other permission needs changing; `contents`, `pull_requests` and
`workflows` are all already sufficient (pushing, merging, closing and reopening
PRs all work).

**The workaround, and its cost.** Closing and reopening a PR re-fires
`pull_request` with action `reopened`, which is a default trigger, so CI runs.
It works — but it is a state change on a real PR that notifies subscribers, and
it is only safe because nothing else was watching. It is not something to reach
for repeatedly.

---

## 2. `--delete-branch` closes a stacked PR instead of retargeting it

**What happened.** `gh pr merge 68 --merge --delete-branch` merged #68 and
deleted `feat/merged-filter-control`. #69 was based on that branch. GitHub did
**not** retarget it to `main` — it **closed** #69. And a closed PR whose base
branch no longer exists cannot be recovered directly:

```
gh pr reopen 69   → Could not open the pull request. (reopenPullRequest)
gh pr edit 69 --base main → Cannot change the base branch of a closed pull request.
```

**Recovery.** Restore the deleted base branch at its original tip, reopen,
retarget, then delete the branch again:

```bash
SHA=$(gh api repos/<owner>/<repo>/pulls/68 --jq .head.sha)
gh api repos/<owner>/<repo>/git/refs -f ref=refs/heads/<base-branch> -f sha="$SHA"
gh pr reopen 69
gh pr edit 69 --base main
gh api -X DELETE repos/<owner>/<repo>/git/refs/heads/<base-branch>
```

**The rule.** When a PR has another PR stacked on it, merge **without**
`--delete-branch`, retarget the child explicitly with `gh pr edit <child> --base
main`, *then* delete the branch. Done in that order the child stays open and
keeps its history. (Verified on #71 → #74: retarget first, delete second, child
untouched.)

Note also that retargeting alone does **not** trigger CI — the base change fires
`pull_request` with action `edited`, which is not one of the default types. Push
a merge of `main` into the child branch instead: it brings the branch up to date
*and* fires `synchronize`, which does trigger.

---

## 3. Supabase auth rate limiting is a routine CI failure, not an incident

Already noted in `CLAUDE.md`; recorded here with numbers because it stopped
being occasional.

**Symptom.** One or more suites fail with:

```
AuthApiError: Request rate limit reached
Serialized Error: { status: 429, code: 'over_request_rate_limit' }
```

The failing suite is frequently one the PR does not touch — on 2026-08-27 it hit
`tests/billing/ad-serving-feed.test.ts` on a branch that changed only
`job_postings` policies. That is the tell: **a rate-limit failure has no
relationship to the diff.**

**Cause — two of them, and the second was misdiagnosed for a whole afternoon.**

The first is real but was never the whole story: every integration suite mints
real auth users, the limit is account-wide rather than per-run, and merging
several PRs in a session means runs in quick succession — each merge to `main`
kicks one of its own — so the quota does not recover between them.

The second is that **the retry meant to absorb all of this was guarding the
wrong calls.** See §3a. Six consecutive failures were read as pure volume, and
"wait for the window" was the advice this document gave, because nobody had
read the stack.

**The numbers, measured 2026-08-27.** These are what turn "flaky" into a budget
you can reason about:

| | |
|---|---|
| Call sites creating an auth user across `tests/` + `e2e/` | **38** |
| Auth admin requests each one costs | 2–3 (`createUser`, `generateLink`, `verifyOtp`) |
| So, auth requests per full CI run | **~80–115**, before the seed step's own |
| Test accounts **still sitting** in the CI project | **113** |
| …of those, created in the previous 24 hours | 113 |
| …of those, created in the previous 3 hours | 56 |

**READ THE LAST THREE ROWS CAREFULLY — they are not what they first look
like.** They count accounts that SURVIVED, not accounts that were created.
`deleteTestUsers` removes most of them on the way out, so those figures are a
floor on LEAKAGE and say nothing about how many auth requests a run actually
made. They cannot be used to derive a per-run cost, and an earlier version of
this section invited exactly that mistake.

The evidence that they cannot: one failing run happened in an hour where only
**three** accounts survived. Read as creation volume that would say the limit
is nothing to do with volume — which is a conclusion about cleanup efficiency,
not about the rate limit.

The per-run figure above (~80–115) is derived from the CODE — 38 call sites
times 2–3 requests each — and is the only one of these numbers that measures
requests. Trust that one; treat the survivor counts as a leak metric only.

The accounts do leak, and that is deliberate at the source: `deleteTestUsers`
reports rather than throws, because a cleanup failure should not turn a passing
run red, and a killed process skips the hook entirely. And the budget is spent
per RUN, so a session that merges several PRs — each merge to `main` kicking a
run of its own — exhausts it and then cannot recover while more runs are
queued.

**What it looked like when it got bad.** Four consecutive runs failed
identically, always naming `tests/billing/ad-serving-feed.test.ts` — a suite
none of those branches touched. `main` itself went red for three merges
running. Every one of them reported `530 passed | 11 skipped` with only the
user-minting suites at the tail failing on 429. **A red `main` in that state is
not a regression**, and it is worth checking the failure text before treating it
as one.

**What to do.** Confirm the failing assertions are all `429`s and unrelated to
the change, then wait — 15 minutes was not enough; the window is longer. Do not
"fix" a suite that failed this way, and do not re-trigger on a short cycle:
each attempt spends more of the same budget and slows recovery.

Do NOT purge the leaked accounts to "clean up" while the limit is active
either. Every delete is another auth admin request against the same exhausted
quota, so the cleanup makes the immediate problem worse. Purge once runs are
passing again.

### 3a. The retry was guarding the two calls that never failed

Found on the seventh failure, by reading a stack trace instead of the failure
count. Every one of them came back identically:

```
SupabaseAuthClient.verifyOtp   node_modules/@supabase/auth-js/...
sessionFor                     tests/support/auth.ts:93
createAuthedTestUser           tests/support/auth.ts:107
```

`withRateLimitRetry` wrapped `createUser` and `generateLink`. **Neither has
ever been the call that failed.** `verifyOtp` is metered separately by Supabase
from creating a user or minting a link, and it had no backoff at all — so the
helper written specifically so that "a transient limit costs seconds not a run"
sat on the two calls that were not being limited. Now wrapped, in the same
shape as the other two.

**The measured effect, same day:**

| run | result | duration |
|---|---|---|
| the fix's own PR | green | 3m21s |
| next PR, first attempt | green | 3m52s |
| the one after | failed | **10m7s** |

Two consecutive runs passed where six in a row had failed. The third failed —
and its ten minutes against a normal three or four is the backoff *working*,
absorbing retries until four attempts ran out.

**The ceiling, which is structural and not a tuning choice.** The backoff runs
inside `beforeAll`, and `vitest.config.ts` gives a hook 60 seconds. Four
attempts at 3/6/12/24s is 45s of waiting. A backoff long enough to ride out a
multi-minute window cannot live there — it would fail the hook before it
finished waiting. So the retry absorbs a burst and roughly two consecutive
runs' worth of pressure, and nothing beyond that.

**What to expect in practice.** About two runs per window. Plan a merge train
around that, and if a third run in quick succession fails on 429, it is this
ceiling and not a regression.

**What would actually fix the rest.** Fewer users per run. `tests/support/auth.ts`
already argues for exactly this — "create FEWER users … suites should seed state
directly with the service role wherever a real session isn't the thing under
test, and share one user across cases that don't need isolation" — and 38 call
sites is the measure of how far that advice has been followed. The
retry-with-backoff in `withRateLimitRetry` buys headroom but does not create
budget, and does nothing when the limit is exhausted before the run starts.

Worth being plain about the direction of travel: two suites added on
2026-08-27 (`tests/rls/feedback-write-only.test.ts`,
`tests/profile/settings-write.test.ts`) account for 4 of those 38 sites. Each
was justified on its own, and together they are the pattern — the budget gets
spent one reasonable test at a time.

---

## 4. `e2e/jd-demo.spec.ts`: "the day's ceiling refuses a fresh visitor once it is spent" times out at 30s

**Status: open, unowned.** Found 2026-09-02 while wiring the
`anonymous_demo_daily` lease into this file for PR #191 (fix #2 of that PR's
three). Not fixed there — it is unrelated to that PR's fix and none of the
four flake-ledger entries named it, so fixing it would have been scope creep
beyond what was diagnosed.

**Symptom.** Run in isolation (`npx playwright test e2e/jd-demo.spec.ts -g
"the day's ceiling refuses a fresh visitor once it is spent"`) against a local
production build, this one test times out at exactly 30s. The other five
tests in the same file pass.

**Confirmed pre-existing, not caused by PR #191's lease fix.** The isolated,
filtered run failed the same way consistently (not intermittently) on the
modified code. To rule out the lease change as the cause: `git status --short`
confirmed the four touched files, `git stash -u -q` reverted them, `npm run
build` succeeded on the unmodified baseline, the server was restarted, and the
identical isolated test was re-run against that baseline — it **also timed
out at 30.0s**. `git stash pop -q` restored the changes, re-confirmed via
`git status --short`. So this is not something PR #191 introduced.

**Not yet diagnosed further than that.** One live hypothesis worth checking
first, given CLAUDE.md's own note that "production runs Gemini on a free-tier
key (20 req/day, shared)": if this test's path makes a real Gemini call and
the shared key's daily cap is already spent when the suite runs, a 30s wait
could be a real (if unhelpfully silent) upstream stall rather than a bug in
the test or the route. That is a guess, not a finding — it has not been
checked.

**Next check, concretely.** Run the isolated test with tracing
(`--trace on`) or `DEBUG=pw:api`, and look at what the 30s is actually spent
waiting on:
- If it's a network call to the Gemini API that never resolves or resolves
  slowly, check whether the free-tier key's daily quota was exhausted at the
  time of the run (consistent with the hypothesis above), and consider
  whether this route needs its own timeout/fallback independent of Gemini's
  latency.
- If it's a `page.waitForX` or assertion with no matching network activity,
  the bug is in the test or the route's response shape, not upstream latency.

**Owner.** Unowned. Pick this up before the next change to
`e2e/jd-demo.spec.ts` or to the JD-demo AI call path (`/api/public/jd-demo`)
— don't let a second unrelated PR go past it silently the way this one did.

---

## 5. `gh run rerun` bypasses the CI lock's ordering — use a fresh push instead

**The rule.** Never use `gh run rerun` to retry a CI run on this repo. Merge
an empty commit, push a real fix, or let the run wait in the natural queue —
not the rerun button.

**Why, briefly.** `gh run rerun` re-executes a run's original `run_number`
while genuinely restarting its clock. Confirmed 2026-09-02 via
`gh api .../runs/517/attempts/{1,2}`: `run_started_at` reset from 07:54:05Z to
08:04:14Z across the two attempts while `run_number` stayed fixed at 517.
`.github/scripts/wait-for-ci-lock.sh` used to order strictly by `run_number`,
so a reran older run could start alongside a genuinely-live newer run instead
of waiting for it — this was the direct, confirmed cause of two of the four
2026-09-01 flake-ledger entries (the GoTrue-500 failures in
`referrals.test.ts` and `cross-user.test.ts`), both of which followed a
same-session `gh run rerun` issued while something else was still live.

PR #191 fixed the script to order by `run_started_at` instead (with
`run_number` as a same-second tiebreak), which makes a rerun wait correctly
rather than jumping the queue — so the correctness hazard above is closed.
**The habit rule stands anyway**: a rerun still costs the same six-to-nine
minutes a genuine re-queue would, the fix has only ever been proven against
synthetic data (see PR #191's description) rather than a real overlapping
rerun, and a fresh push needs no safety net at all. Don't spend the one you
have just proved works when you don't have to.

---

## Not a gap: a stacked PR gets no CI until it retargets

`ci.yml` fires on three things:

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch: {}
```

So a PR whose base is another branch gets no automatic run — `pull_request` is
filtered to `main`, and `push` only fires for `main` itself. That is
deliberate: every run contends for the one shared Supabase project, and
widening it would multiply exactly the contention §3 is about. The cost is that
a stacked PR's verification is local-only until its base merges. Plan the merge
order around it rather than widening the trigger.

**The `push: branches: [main]` half is easy to forget and it is what makes §3
bite.** Every MERGE kicks a run of its own, so merging one PR and pushing the
next spends two runs back to back — which is more than a window holds. An
earlier version of this section listed only the `pull_request` trigger and so
described a workflow that would not have had this problem at all; a docs-only
PR then failed on the auth rate limit two paragraphs below its own
explanation, because its push landed immediately after a merge.

Leave a gap after each merge before pushing the next branch. The runs do not
fight each other for the database — `concurrency` is per-ref and
`.github/scripts/wait-for-ci-lock.sh` BLOCKS rather than discarding, so an
earlier run finishes before a later one starts — but they do share the
account-wide auth budget, and blocking does not refill it.

---

## Not a gap: Search Console's `employmentType` warning on job postings

Google Search Console flagged three recommended `JobPosting` fields missing
from live listings: `validThrough`, `baseSalary`, `employmentType`. The first
two were real gaps and were fixed (migration 0085, `src/lib/jobs/sources
/schema-org.ts`'s `mapValidThrough`/`mapBaseSalary`, and the corresponding
emission in `src/lib/seo/job-posting-jsonld.ts`). `employmentType` is not —
`mapEmploymentType` in the same parser file has mapped it since this fetcher
was first written, and `job-posting-jsonld.ts`'s `EMPLOYMENT_TYPE` lookup has
always emitted it whenever the column is set.

**The warning is genuine data absence, not a missed mapping.** A source that
never states `employmentType` in its own JobPosting markup gives this pipeline
nothing to map — measured against production on 2026-09-02, ahead of this fix:
138 of 156 open postings have no `employment_type` at all. That is the sources'
own gap, not this codebase's, and Google's guidance for a recommended field
with no real value is to OMIT it, not to invent one. Guessing a value from a
title or a description (a "Full-time" mention, a "Backend Engineer" title that
sounds permanent) would be exactly the fabrication this whole feature was
built to avoid doing for `validThrough`/`baseSalary`, applied to a field where
it happens to be easier to get away with because nobody would notice a wrong
guess as readily as a wrong salary.

**So: if this warning still shows in Search Console after 0085 ships, that is
expected, not a regression to chase.** It closes only as more sources start
stating `employmentType` themselves, or as new internal postings (which the
employer form already collects it for) make up a larger share of the board.
Nothing here calls for inferring the field — recorded so a future pass at
Search Console findings does not spend time "fixing" a warning that is already
the correct behaviour.
