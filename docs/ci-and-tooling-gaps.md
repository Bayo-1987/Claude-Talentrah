# CI and tooling gaps

Three operational facts that cost real time on 2026-08-27 and will cost it
again unless they are fixed at the source. Each one has a workaround, and each
workaround has a side effect — which is the reason to write them down rather
than keep routing around them.

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

**Cause.** Every integration suite mints real auth users, and the limit is
account-wide, not per-run. Merging several PRs in a session means many runs in
quick succession — each merge to `main` also kicks a run — and the quota does not
recover between them. Three separate runs hit it in one afternoon.

**The numbers, measured 2026-08-27.** These are what turn "flaky" into a budget
you can reason about:

| | |
|---|---|
| Call sites creating an auth user across `tests/` + `e2e/` | **38** |
| Auth admin requests each one costs | 2–3 (`createUser`, `generateLink`, `verifyOtp`) |
| So, auth requests per full CI run | **~80–115**, before the seed step's own |
| Test accounts sitting in the CI project | **113** |
| …created in the previous 24 hours | 113 |
| …created in the previous 3 hours | **56** |

Two things follow. The accounts are **leaking** — `deleteTestUsers` reports
rather than throws (deliberately: a cleanup failure should not turn a passing
run red), and a killed process skips the hook entirely. And the budget is spent
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

**What would actually fix it.** Fewer users per run. `tests/support/auth.ts`
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

## Not a gap: CI only runs on PRs targeting `main`

`ci.yml` is `on: pull_request: branches: [main]`, so a stacked PR gets no CI run
until its base merges and it retargets. That is deliberate — every run contends
for the one shared Supabase project (see the concurrency-group note in
`ci.yml`), and widening the trigger would multiply exactly the contention that
causes §3. The cost is that a stacked PR's verification is local-only until its
turn. Plan the merge order around it rather than widening the trigger.
