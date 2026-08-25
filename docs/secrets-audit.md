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

## Recommendation, not done here

There is no standing check. A secret scan in CI (`gitleaks` has a GitHub
Action) would turn this from a thing found twice by accident into a thing that
cannot land. Not added in this pass because it is a new CI dependency and that
is the founder's call.
