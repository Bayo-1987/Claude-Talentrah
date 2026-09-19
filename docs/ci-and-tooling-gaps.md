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

## 5. `gh run rerun` — use a fresh push instead

**The rule, unchanged.** Never use `gh run rerun` to retry a CI run on this
repo. Merge an empty commit, push a real fix, or let the run wait in the
natural queue — not the rerun button.

**The reason has changed, and saying so is the point.** This section used to
justify the rule with a live correctness hazard: `gh run rerun` re-executes a
run's original `run_number` while restarting its clock, and
`.github/scripts/wait-for-ci-lock.sh` ordered strictly by `run_number`, so a
reran older run could start alongside a genuinely-live newer one. That was the
confirmed cause of two of the four 2026-09-01 flake-ledger entries (the
GoTrue-500 failures in `referrals.test.ts` and `cross-user.test.ts`).

**That hazard is dead twice over.** PR #191 reordered the script by
`run_started_at`, which makes a rerun wait correctly. Then #214 gave every CI
job its own ephemeral Supabase stack, so there was no shared resource left to
serialise — and the lock script has since been deleted outright. A rerun today
cannot collide with a concurrent run over a database, because concurrent runs
no longer share one.

**So the rule now stands on cost and habit, which is enough.** A rerun costs the
same six-to-nine minutes a genuine re-queue would, and a fresh push needs no
safety net at all — it queues from a clean state, produces a new run number, and
leaves an artefact in the history saying what was retried and why. An empty
commit is `git commit --allow-empty -m "retry ci"`.

**A rule propped up by a dead reason is worse than no rule**, because the first
person to check the reason stops believing the rule. The reason above is the
real one: reruns are not dangerous here any more, they are just the worse of two
equally slow options, and the better one is one command.

---

## 6. `e2e/job-detail.spec.ts`: the card/detail truncation check depends on which real external job sorts first

**Status: the specific "·" symptom fixed and confirmed, 2026-09-19** (commit
`3406f04` on PR #482, `fix/a11y-wcag-gaps`); **the underlying "depends on live
ranking" root cause below is still open.** Read both halves — the fix narrows
this entry's blast radius, it does not close it. Found while merging the
2026-09-14 audit batch (nine PRs, none of which touch job ingestion, the job
card, or the job-detail page) — surfaced as a merge blocker on
`fix/atomic-fulfillment-credit-pack-pass` (PR #399), then reproduced
identically on two other, unrelated PRs (#397, #402) before anyone assumed it
was a flake.

**Symptom.** `e2e/job-detail.spec.ts`'s test "the card title opens the job,
and the job is not truncated there" fails on:

```
expect(full).toContain(cardDescription.slice(0, 100));
```

with the card's truncated text containing a literal "·" (middle dot) and a
line break that the full-page text does not — same underlying
`job.description`, two different renderings.

**Confirmed pre-existing, not caused by any of the three PRs it hit.**
`fix/atomic-fulfillment-credit-pack-pass` touches only
`src/lib/billing/fulfill.ts` and its own migration/test; `chore/bundle-size-ci-safeguard` touches only CI tooling; `fix/marketing-masthead-mobile-nav`
touches only the signed-out marketing masthead. None touch job ingestion,
`job-card.tsx`, or the job-detail page. A `git commit --allow-empty -m "retry ci"` retry on #399
(entry 5's own prescribed method, not `gh run rerun`) failed **identically**
— same test, same file:line, same assertion, same Moniepoint text, byte for
byte — ruling out ordinary run-to-run flakiness in favour of a currently-live,
deterministic cause.

**Root cause, traced to actual code, not guessed.** The test asserts on
whichever job `page.locator("h3 a").first()` resolves to — the top of the
"Recommended" feed, with zero control over which real posting that is.
`src/lib/jobs/sources.config.ts` configures Moniepoint as a live Greenhouse
source (`{ source: "greenhouse", token: "moniepoint", ... }`), not a fixture;
`docs/phase-1-summary.md` records measuring "Moniepoint's live board: 127
postings" directly. `scripts/seed.ts` calls
`fetch(`${devServerUrl}/api/admin/ingest-jobs`, ...)` — CI's seed step
genuinely fetches real external boards, Moniepoint included, on every run. A
Moniepoint "Senior Content Designer" listing currently sorts first and its
raw description uses a literal "·" as a bullet/separator instead of this
app's own "- " convention.
`stripMarkdownToPlainText()` (`src/lib/jobs/extract-jd.ts`, used for the job
card's truncated preview) only strips `**bold**` and leading "- " — it does
not recognise "·" and passes it through unchanged. `renderJobDescriptionMarkdown`
(used on the full job-detail page, see `src/app/(app)/jobs/[id]/page.tsx`)
handles the same raw text differently. Two renderings of the same posting
therefore genuinely disagree, and will keep disagreeing on any future CI run
where this posting — or another one shaped like it — sorts first.

**This is not a one-batch exception.** It will recur on any future PR's CI,
unrelated to that PR's own diff, for as long as (a) this test depends on
whichever job real external ranking puts first, and (b) any live source board
contains a posting using a bullet character `stripMarkdownToPlainText` doesn't
strip. Nine PRs merged past this on 2026-09-14 with an explicit per-PR note
citing this entry rather than a bare "known flake, ignoring it."

**Next check, concretely.** Two independent angles were on the table; only the
first is done (see below) — the second is exactly what's still open:
- Make `stripMarkdownToPlainText` (or the ingestion step that produces
  `job.description`) handle the wider range of bullet/separator characters
  real scraped HTML actually contains — not just "- ". Check for em-dash,
  asterisk-bullet, and other Unicode bullet characters while in there; this
  exact defect shape will recur with a different source posting otherwise.
- Stop making this test's assertion depend on live external ranking at all —
  seed a synthetic or internal-only job posting specifically for
  `job-detail.spec.ts` to assert against via a stable selector, rather than
  `.first()` on whatever the real feed currently ranks top.

**What was actually fixed, 2026-09-19, and how it differs from the first
option above.** Rather than extending `stripMarkdownToPlainText`'s character
list (which would still be one Unicode bullet variant behind the next live
posting that trips it), the test's own comparison
(`e2e/job-detail.spec.ts:74`) now strips ALL whitespace and separator-dot
characters (`/[\s·•‧∙]+/g`) from both the card and full-page text before
comparing, via a `bareChars()` helper. This makes the assertion
whitespace/separator-agnostic rather than exact-substring, which is what it
was always supposed to mean ("the full page opens with the same content the
card previewed") — not "byte-identical whitespace across two independent
text-rendering paths." Verified directly against the exact strings from the
CI failure log (the Moniepoint "·" case) before merging, and confirmed the
fix doesn't loosen the check to the point of vacuity — it still requires the
actual characters to match, just not the whitespace/punctuation around them.

**What's still open, confirmed by reproducing it again the same day.**
Re-running this same test locally (against the shared dev database, whose
"first" job in the Recommended feed differs from CI's) hit a DIFFERENT
assertion in the same test — `full.length > cardDescription.length` — because
a completely different job (an 86-character description, shorter than the
card's 280-char truncation limit) happened to sort first. This is the SECOND
option above, untouched: the test still asserts on `.first()` of whatever the
real feed currently ranks top, so any sufficiently short or unusually-shaped
live description can still trip some assertion in this test, on any given CI
run, for a reason that has nothing to do with the "·" fix above. Whoever picks
up the second option should not read the 2026-09-19 fix as this entry's
closure — narrower failure surface, same open root cause.

**Owner.** The "·"/whitespace half above is fixed (commit `3406f04`, PR #482).
The "depends on live ranking" half is unowned as of this writing — the
2026-09-14 note's "separate in-flight session" was never confirmed to have
landed a fix for it; check current `main` for a stable-fixture rewrite of this
test before assuming it's still open.

---

## 7. Every Dependabot PR failed CI outright on `DEMO_PASSWORD is not set` — fixed in `scripts/seed.ts`

**Status: fixed and confirmed, 2026-09-15** (merged to `main`, PR #410).
Confirmed against five real Dependabot CI runs post-merge — see Owner below,
not just the intended fix. Found
while getting a fresh go/no-go status on seven new open PRs — five of them
Dependabot's (`#409` npm, `#371`/`#372`/`#373`/`#374` GitHub Actions version
pins), all failing identically on the `checks` job itself, before `e2e` even
ran.

**Symptom.** `Typecheck, lint, unit tests` fails on all five with:

```
Error: DEMO_PASSWORD is not set. Add it to .env.local (and to CI secrets for the e2e job).
```

thrown by `scripts/seed.ts`'s own guard (line 62-68 as of the previous
revision), during the `checks` job's "Seed demo data (full)" step. `e2e`
shows `SKIPPED`, not `FAILURE` — it never got to run.

**Confirmed pre-existing and structural, not caused by any of the five PRs'
own diffs.** A routine npm version bump and four routine Actions version pins
do not touch `scripts/seed.ts`, `ci.yml`, or anything seed-adjacent — checked
directly via `git diff origin/main...origin/<branch> --name-only` for each.
The two non-Dependabot PRs checked in the same pass (`#396`, `#406`) do not
hit this at all.

**Root cause, traced to actual behaviour, not guessed.** `ci.yml:51` sets
`DEMO_PASSWORD: ${{ secrets.DEMO_PASSWORD }}` at the workflow-`env` level,
read by every job. All five failing runs are `pull_request` events on
`dependabot/*` branches (confirmed via `gh run view --json event,headBranch`).
Checked against GitHub's own docs ("Troubleshooting Dependabot on GitHub
Actions" → "Accessing secrets"), not assumed from memory: *"When a Dependabot
event triggers a workflow, the only secrets available to the workflow are
Dependabot secrets. GitHub Actions secrets are not available."* Regular
repository secrets — `DEMO_PASSWORD` included — are invisible to any
workflow run GitHub attributes to Dependabot, regardless of what that PR's
diff contains. `${{ secrets.DEMO_PASSWORD }}` then resolves to an empty
string, and `scripts/seed.ts`'s unconditional guard throws.

One assumption checked before picking a fix, not before: whether the repo's
**Dependabot secrets** store (Settings → Secrets and variables → Dependabot —
a separate mechanism from regular Actions secrets, normally used for
Dependabot's own private-registry auth during dependency resolution) would
even reach this `pull_request`-triggered CI workflow if `DEMO_PASSWORD` were
added there. The same GitHub doc answers this too, and the answer is
"yes" — Dependabot secrets ARE what a Dependabot-triggered workflow run gets
instead of Actions secrets. So adding it there was a real, viable option; it
was not the one chosen (see below).

**Not a one-batch exception.** Every future Dependabot PR against this repo
hits this identically, forever, until fixed — the failure has nothing to do
with what any individual bump contains.

**Fix chosen and why.** Code fix in `scripts/seed.ts`, not a settings change:
when `DEMO_PASSWORD` is unset AND `process.env.CI` is set, generate a random
per-run value with `randomBytes(24).toString("hex")` instead of throwing, and
write it to `$GITHUB_ENV` (same idiom `ci.yml` already uses for its own
per-run `INGEST_SECRET`) so the *same job's* later steps see the matching
value. This is deliberately **not** the hazard the file's own no-fallback-default
comment warns about — that rule is about a fixed, committed default becoming
a de facto shared password; a value regenerated every run and thrown away
with the ephemeral database it created has none of that shape.

Checked, not assumed, before relying on this being safe for `checks`: none of
the four unit tests the "full seed" step exists for
(`tests/seo/landing-page-links.test.ts`,
`tests/billing/pricing-catalog-rebase.test.ts`,
`tests/rls/org-and-referral-scoping.test.ts`, `tests/seed/catalog.test.ts`)
reference `DEMO_PASSWORD` or a login flow — grepped directly. They need a
seeded demo account to exist, never a specific password value.

`e2e` runs the identical `scripts/seed.ts` a second time, independently, into
its own separate ephemeral database, and *does* have specs that log in as
this account by reading `process.env.DEMO_PASSWORD` directly
(`job-detail.spec.ts` among many others) — checked via grep across `e2e/`,
not assumed to be checks-only. The `$GITHUB_ENV` write covers this case too,
since it's the same script and the write lands before the login-driving
Playwright step runs in the same job.

Verified before merging, not just by inspection: ran the exact guard logic
standalone with `CI=true` and `DEMO_PASSWORD` unset — confirms a value is
generated and written to a `$GITHUB_ENV`-shaped file — and separately with
neither `CI` nor `DEMO_PASSWORD` set, confirming local development still
throws exactly as before (no silent fallback outside CI). Full `npm run
build`, `npx tsc --noEmit`, and `npm run lint` all clean on the fix branch.

Once past this, a Dependabot PR still hits the documented **entry 6** e2e
issue like every other PR — this fix only removes a *different*, earlier
blocker that stopped `e2e` from running at all.

**Owner.** Merged to `main` via PR #410, merge commit `3d6cbd8`
(2026-09-15). Confirmed against real Dependabot CI runs, not just the
intended fix: retried CI (empty "retry ci" commits, entry 5's method, not
`gh run rerun`) on all five PRs that were failing before this
merged — `#409` (npm), `#371`/`#372`/`#373`/`#374` (GitHub Actions version
pins). All five came back with `checks` genuinely green (the seed step that
was throwing now passes) and `e2e` running to completion rather than being
skipped — each hitting only the documented **entry 6** truncation assertion
on `job-detail.spec.ts:54`, nothing new, and none showing the old
`DEMO_PASSWORD is not set` error. Runs checked directly:
[#409](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/34921680094/job/104232104300),
[#371](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/34921688575/job/104232162959),
[#372](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/34921698585/job/104232186641),
[#373](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/34921706277/job/104232204835),
[#374](https://github.com/Bayo-1987/Claude-Talentrah/actions/runs/34921716334/job/104232283123).
This confirms the mechanism relied on for the fix to reach these
branches at all — `actions/checkout`'s default ref for a `pull_request`
event is a merge of the PR's head with the current base (`refs/pull/N/merge`,
per GitHub's own docs), so none of the five needed their own branch touched;
retriggering their CI against the now-fixed `main` was sufficient.

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

Leave a gap after each merge before pushing the next branch. The runs no longer
fight each other for a database at all — since #214 each job starts its own
ephemeral stack — but they do share the account-wide auth budget of whatever
hosted project a run still reaches, and nothing refills that.

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
