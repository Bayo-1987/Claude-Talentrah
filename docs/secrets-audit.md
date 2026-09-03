# Secrets audit — 2026-08-25

Prompted by PR #24, where the demo account's password turned out to be
committed in plaintext in three files of a **public** repo. That was found by
accident, while chasing an unrelated RLS bug. This is the deliberate version of
that check.

**Scope: every object in the git object database**, not just `HEAD` and not just
reachable commits — `git cat-file --batch-all-objects` also covers blobs
orphaned by amends and rebases, which is exactly where a secret "removed before
pushing" would still live. 414 blobs scanned. Two passes: provider key shapes
plus secret-named literals, then a separate high-entropy / long-hex sweep to
catch a token that isn't attached to a secret-shaped variable name.

## Headline

**Two real, still-live credentials were found beyond what PR #24 already fixed.
Both are now rotated and the published values confirmed dead.** Nothing else in
this repo's history is a currently-valid secret.

## Everything found

| # | Value | Where | Verdict |
|---|---|---|---|
| 1 | `TalentrahDemo123!` | `README.md`, `scripts/seed.ts`, `e2e/masthead-nav.spec.ts` | **Real credential — rotated in PR #24.** Old value confirmed rejected by the live project. |
| 2 | `TalentrahDemoFriend123!` | `scripts/seed.ts` (3 call sites) | **Real credential, still live at the time of this audit.** Shared by two real accounts on the live project (`amaka.friend@`, `chidi.friend@`). Missed by PR #24, which rotated only the demo user. **Rotated; both confirmed rejected.** |
| 3 | `957ad7212fd3797b00a4db74581605e9` | `src/app/api/_diag-gemini-check/route.ts` (deleted at HEAD) | **Real secret, no longer guards anything.** See below. |
| 4 | `VitestUpsertBaseResume123!` | `tests/resume/upsert-base-resume.test.ts` | Throwaway account created in `beforeAll` and deleted in `afterAll` — no persistent account. Still a committed literal in a public repo, and the account is real for the seconds a CI run takes, so it is now randomised per run. |
| 5 | `secret = "A-private-resume"` | `tests/rls/cross-user.test.ts` | **False positive.** Fixture string used to prove user B cannot read user A's resume content. |
| 6 | `token = "moniepoint"` | `src/lib/jobs/sources.config.ts` | **False positive.** A Greenhouse job-board slug — a public URL segment, not a credential. |

Nothing else matched: no JWT, no `sk_`/`pk_` key, no `AIza…` Google key, no
`gsk_` Groq key, no Resend or Anthropic key, no AWS or GitHub or Slack token, no
private-key block, no connection string with a password. The high-entropy sweep
returned 27 candidates, of which 26 were identifiers, URLs and TypeScript type
names; the 27th was #3.

## `.env` files

- **No `.env` or `.env.local` has ever been committed.** The only `.env*` file
  in history is `.env.example`, added 2026-08-21.
- `.gitignore` line 38 covers `.env*`, with `!.env.example` on line 39.
- `.env.example` holds four non-empty values, all deliberately non-secret: the
  Supabase project URL (shipped in the client bundle by design), `LLM_PROVIDER=gemini`,
  `CONTACT_EMAIL_TO=support@talentrah.com`, and `SEED_APP_URL=http://localhost:3000`.
  No real value was ever pasted in place of a blank.
- `INGEST_SECRET`, `CRON_SECRET` and the pass-renewal secrets appear only as
  `process.env` references and in comments. No literal, ever.

## The diagnostic route (#3), in full

A temporary token-gated endpoint added on 2026-08-23 to check whether
`GEMINI_API_KEY` was set in Vercel's Production scope. Four commits, all on
`main`: added, path fixed, path fix reverted, route reverted.

The first path — `src/app/api/_diag-gemini-check` — was **never routable**:
Next.js App Router excludes any segment starting with `_`. Only the middle
commit (`7b0d547`, path `api/diag-gemini-check-9f3a2`) produced a reachable
endpoint, and it was a production deployment.

**Exposure: ~4 minutes.** The routable deployment was created at
`1787503663111` and superseded by the revert at `1787503900219` — 3 min 57 s.
Both the path and the token were public in the repo for that window and remain
in history.

Current state, verified rather than assumed:

- Production (`claude-talentrah.vercel.app`) returns Next's HTML 404 for both
  paths, byte-identical to a route that never existed — so the endpoint is gone,
  not merely token-gated. (Checked with a deliberately wrong token, so no real
  Gemini call was made: the route would have answered a JSON `{"error":"not found"}`.)
- Every historical deployment URL, including the one that served it, returns
  **302** — the project has Vercel SSO protection enabled for
  `all_except_custom_domains`, so old deployments are not publicly reachable.

**No rotation is possible or needed:** the token guarded a route that no longer
exists in any reachable deployment. Had it still been live, the worst case was
Gemini quota burn plus a `keyLength` disclosure — the route never returned the
key itself.

## On scrubbing history

Deliberately not attempted. The repo is public, so anything ever pushed must be
assumed permanently captured; a rewrite that misses one object gives a false
sense of safety while breaking every clone and fork. **Rotation is the fix** —
the same conclusion PR #24 reached, applied consistently here.

## What this audit could not cover

GitHub's own secret-scanning alerts (`/secret-scanning/alerts`) returned
**403 — resource not accessible by personal access token**. That is a
provider-validated second opinion this sweep did not get; it is worth a look
under the repo's **Security → Secret scanning** tab. The scan here is
pattern-based and covers the shapes listed above; a provider-issued key in a
format not on that list would not have matched.

## Standing check — added 2026-08-25

`gitleaks` now runs on every pull request and every push to `main`, scanning
the commits the change introduces, and **fails the build** on a match. Config
and reasoning live in [`.gitleaks.toml`](../.gitleaks.toml).

The part worth knowing: **gitleaks' default rules would have caught neither of
this repo's two real leaks.** Measured against all three known secrets —

| Secret | Default config | With `.gitleaks.toml` |
|---|---|---|
| `DIAG_TOKEN = "957ad72…"` | caught | caught |
| `DEMO_PASSWORD = "TalentrahDemo123!"` | **missed** | caught |
| `password: "TalentrahDemoFriend123!"` | **missed** | caught |

The defaults are tuned for machine-generated provider keys — long, high
entropy, known prefixes. Both real leaks here were human-chosen passwords,
which clear none of those bars. A custom rule with no entropy floor closes
that, and the two documented false positives from this audit are allowlisted
by exact value with the reason written down.

Proven, not assumed: a throwaway branch reintroducing both real credentials was
opened as a PR, and the Secret scan job failed with exit 1, values redacted.
The branch was closed and deleted.

### What it does not cover

- **Diff only, not full history.** Each run scans the commits the change adds.
  History is already covered by this one-off audit; re-scanning it every CI run
  would fail every build forever on the rotated values recorded above.
- Pattern-based, so a credential in a format not matched by gitleaks' defaults
  or the custom rule still gets through. It narrows the gap; it does not close it.
- Nothing stops a secret reaching a **Vercel preview deployment** or an Actions
  log from a source other than the repo.

## CI seeds the production database — found while proving the scanner

The throwaway branch above reintroduced the old literals, and CI ran
`npm run seed` against the live project as it always does. The seed re-asserted
passwords on every run, so **all three live accounts were reset to the
published passwords** by that one PR. Caught immediately (the e2e login failed),
re-rotated, and re-verified dead.

That was a real hole, not just an accident of the test: with CI seeding the
live project, *any* pull request could set the demo account's password to a
value of its choosing by editing `scripts/seed.ts`. Now gated — the seed
creates missing accounts but never rewrites an existing password unless
`SEED_ROTATE_PASSWORDS=1` is set, which CI never sets. Verified both ways: a
CI-style seed reports `password left as-is`, and rotation still works when the
flag is passed.

The underlying cause is the one already on the known-defects list: there is no
staging database, so CI writes to production.

## Closed 2026-08-31 — no history rewrite; rotation is the resolution

The founder reviewed this audit's findings and its reasoning and decided
against rewriting git history. **Rotation stands as the final resolution, and
this is now closed rather than deferred.**

That confirms the position *On scrubbing history* above rather than overriding
it: the repository is public, so anything ever pushed must be assumed
permanently captured, and a rewrite that misses one object buys a false sense
of safety at the cost of breaking every clone and fork. It is the same
conclusion PR #24 reached.

The premise holds on the evidence already recorded here. Both real credentials
that were still live at the time of the audit — `TalentrahDemoFriend123!` and,
earlier, `TalentrahDemo123!` — were rotated and their published values
**confirmed rejected by the live project**. The third finding was a Gemini key
that no longer guards anything. Nothing in this repository's history is a
currently-valid secret.

**Recorded so it is not re-raised.** "Should we scrub the history?" is a
reasonable question to arrive at independently, and it has now been asked and
answered twice on the same facts. Reopening it needs a new fact — a
newly-discovered live credential, or a change in what the history contains —
not a fresh reading of the same ones.

Two things this does *not* close, both still standing above: the
provider-validated second opinion under **Security → Secret scanning** that
this sweep could not obtain (403), and the underlying absence of a staging
database that let CI write to production in the first place.

## Working-tree finding — 2026-09-02, `.env.example`

Caught mid-session, not by a scan: a routine `git status` after switching
branches (the standing habit before any command that could discard
uncommitted work) showed `.env.example` as **modified**, with `CRON_SECRET`
set to a real-shape 64-character hex string — not the blank placeholder the
committed file carries. No tool call in that session had written to the
file; the mtime lined up with the founder's own CRON_SECRET rotation around
the same time, so the likeliest explanation is a value pasted into the wrong
file while rotating it elsewhere, not a leak this repo's own tooling caused.

**Response, in order:**

1. **Verified history before touching anything.** `git log -1 -- .env.example`
   showed no commit anywhere near that content, and `git status --short`
   confirmed the change was local and unstaged — the value had never been
   `git add`ed, let alone committed or pushed. This repo is public
   (see *On scrubbing history* above), so that check is the whole question:
   an uncommitted value in a working tree was never captured anywhere this
   audit's premise — "anything ever pushed must be assumed permanently
   exposed" — applies to.
2. **Reverted immediately.** `git checkout -- .env.example` restored the
   committed placeholder, then `git status --short` confirmed no trace
   remained.
3. **Flagged rather than silently fixed.** Reported the finding to the
   founder in the same turn, without repeating the value, and recommended
   double-checking nothing else had it pasted somewhere unsafe.
4. **Rotated anyway, out of caution.** Even with history confirmed clean,
   `CRON_SECRET` was rotated a second time — set in both Vercel and GitHub
   Actions — specifically because of this finding, on the reasoning that a
   value real enough to look load-bearing is worth retiring rather than
   trusted on a history check alone. Production redeployed via the next
   merge to `main` rather than a manual redeploy, and the next scheduled
   ingest call was verified to authenticate cleanly against the new value
   (see the PR that carried the rotation for that verification).

**The standing rule this reinforces:** production secrets live in exactly
two places — Vercel environment variables and GitHub Actions secrets — and
nowhere in this repository, committed or not. `.env.example` exists to show
which keys exist, never what any of them are worth; a real value pasted into
it even temporarily, in a working tree that is never pushed, is still the
wrong file for it to have touched. The fix here was not "don't leak it" —
nothing left this machine — it was "stop, verify, revert, flag, and rotate
if there is any doubt," the same order this file's own two real leaks above
were handled in.
