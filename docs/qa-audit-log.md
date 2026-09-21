# QA / security audit log

A standing engineering-oversight practice runs against this repo on a
schedule: a fresh, isolated session each time, with no memory of any prior
run except what it can read here and in the git history itself. **This file
is the only continuity mechanism that actually works across runs** — each
fire starts in its own throwaway cloud workspace with no access to any other
session's local files, so a previous run's scratch notes, browser state, or
`/home/claude/out/` are gone by the time the next one starts. Only a normal
`git fetch` survives.

Convention: **prepend** each new entry immediately below this header, dated,
newest first. Say what was tested, what was found (by severity), what was
fixed (with PR links), and what was escalated (with `docs/qa-audit/*.md`
links) — specific enough (real file paths, real PR numbers, real migration
numbers) that a future run can tell what's already been covered without
re-doing the work. Note anything checked and found already-tracked or
deliberately accepted, so it isn't re-reported as new. A run should also
record environment limitations it hit and how it worked around them (or
couldn't), since the next run starts from an equally fresh sandbox and will
hit the same ones blind otherwise.

---

## 2026-09-21 — send-451: signup-form password-field-clears-everything quirk, closed

Follow-up to the first run's own "one dead end worth recording" note
(below): that run saw `/signup`'s First name/Last name/Email/Country fields
sometimes empty the moment Password was filled via Playwright's `.fill()`
(a single synthetic `input` event — the same shape a password-manager
autofill or a paste produces), did not reproduce via real keystroke-by-
keystroke typing, and could not run `next build` in its own sandbox
(`fonts.googleapis.com` blocked) to check whether it was a real bug or a
dev-mode artifact — so it was correctly left unfiled rather than reported.

**This send ran from an environment that CAN run a real build, and did.**
`npm run build && npm run start` completed cleanly (no network
restrictions here); `/signup` served normally.

**Reproduced or not, stated explicitly: NOT reproduced, against a genuine
production build.** Three independent trials against the running
`next start` server, each starting from a fresh page load with cookies
cleared (a stray signed-in session from earlier in this browser profile
caused a `/signup → /jobs` redirect on the first attempt — cleared and
confirmed a genuine signed-out render before each trial):

1. Filled First name/Last name/Email via the native-input-setter +
   dispatched `input`/`change` event technique (matching what `.fill()`
   does under the hood), then bulk-filled Password the same way. All four
   fields read back correctly afterward.
2. Repeated with different values and the Country `<select>` also set via
   its own native setter + `change` event, ruling out an ordering-specific
   or field-specific effect.
3. Repeated a third time using this session's own form-filling tool (a
   different internal mechanism from the raw JS in trials 1–2) for the
   bulk password fill specifically, for trigger diversity.

All three: First name, Last name, Email, and Country stayed exactly as
set; only Password changed.

**Root-caused why, not just confirmed clean.** Read
`src/components/auth/signup-form.tsx` in full, including its own top
comment about the React 19 native-form-reset quirk. That mechanism fires
*after a `<form action={fn}>` submission's result commits* — including on
a validation-error "failure" — and only affects the `<select>`/checkbox
pair (`country`/`termsAccepted`), which is exactly why the file's own
`useEffect` only re-asserts those two. It has no code path that runs on a
plain field `onChange` mid-fill, before any submission — so it structurally
cannot be the mechanism behind a password-field-clears-siblings quirk.
Separately, `set(key)` (the shared onChange factory) does an isolated
`setFields(prev => ({ ...prev, [key]: value }))` per field, with no shared
mutable reference, debounce, or batching that could let one field's update
clear another's. **Genuinely a different, and non-existent-in-production,
mechanism** — not the same bug wearing a different hat.

**Closed as: confirmed dev-mode-only artifact, not a real bug.** No code
change made — per this repo's own "prove a fix by first proving the test
catches the bug" discipline, there was nothing to prove a fix against.
Likely cause of the original dev-mode observation (not verified further,
since it's moot once production is confirmed clean): Next.js dev's
on-demand per-route compilation/Fast Refresh, which the original run's own
note already flagged as the variable that made it stop reproducing once
`/signup` was warm. If a similar "fields clear on bulk-fill" report
surfaces again, checking against `npm run build && npm run start` first
(not `next dev`) should be the very first step, not a follow-up — this
repo's own CLAUDE.md already documents two prior cases of a `next dev`-only
failure evaporating under a real build (the per-page OG image URL and a
Playwright test that hit a dev-only "Rendering…" overlay); this is now a
third, one level earlier — never confirmed as a real product failure in the
first place, only suspected from a dev-mode sandbox.

---

## 2026-09-21 — first run

This is the first run of this practice; no prior entry existed to diff
against; the environment-limitation notes below are worth a future run
reading before it re-discovers them from scratch.

### Environment limitations hit this run (read this first)

This scheduled task runs in an isolated cloud sandbox with a policy-enforced
egress proxy. Three real capability gaps, confirmed rather than assumed (each
via `curl -sS http://127.0.0.1:42615/__agentproxy/status`, which records the
proxy's own rejection reason):

- **`ghcr.io` and `registry-1.docker.io` are both denied** (`connect_rejected`,
  organization policy) — so `npm run db:local` / `supabase start`, the exact
  mechanism this task's own instructions point at for local functional
  testing, cannot pull the Supabase stack's images in this sandbox. The
  Supabase CLI itself installs fine (downloaded the pinned `2.117.0` binary
  matching `.github/actions/local-supabase/action.yml` directly from GitHub
  releases, which IS allowed) — it's only the container images that are
  blocked.
- **`fonts.googleapis.com` is denied** the same way, which makes `npm run
  build` hard-fail (`next/font` throws on a fetch failure at build time,
  unlike `next dev`, which only warns and falls back). Typecheck
  (`npx tsc --noEmit`), lint (`npm run lint`), and `npm audit` are unaffected
  and ran clean.
- **The shared dev project's own host, `dozaffzgqkbarxtlclsj.supabase.co`,
  is ALSO denied** for direct HTTP from this sandbox (confirmed via a direct
  `curl` to its `/auth/v1/signup` endpoint: proxy 403, `connect_rejected`).
  This is a different, narrower thing than "can't reach the internet" — the
  Supabase **MCP connector** (`mcp__Supabase__*`) reaches this same project
  fine, because it goes over a different, permitted channel, so
  `execute_sql`/`get_advisors`/`list_migrations` all worked normally. It's
  specifically the app's own runtime (the Next.js server process, and a
  real browser) that cannot open a socket to it. One concrete, initially
  confusing symptom: `npm run dev` against `.env.local` pointed at
  `dozaffzgqkbarxtlclsj` renders most signed-out marketing pages fine (they
  don't hit the network at all, or fail before any request goes out), but a
  real signup attempt through the UI returns the literal client-visible
  error `Unexpected token 'H', "Host not i"... is not valid JSON` — that is
  `supabase-js` trying to `JSON.parse()` the proxy's own plain-text rejection
  body as if it were a GoTrue response. Confirmed via `execute_sql` that zero
  of the test signups actually landed in `auth.users` — the request never
  reached Supabase, so this is a sandbox-networking artifact, **not** a real
  parse-error bug in the app's own error handling (though see the note below
  about what *would* be worth fixing if this recurs somewhere reachable).
- Net effect: **no DB-backed dynamic testing (signed-up flows, job feed with
  real data, tailoring, tracker) was possible this run**, and neither was a
  Playwright/Chromium visual pass of the live production site (same
  raw-egress restriction — direct navigation to [www.talentrah.com](https://www.talentrah.com) from
  this sandbox's browser also gets the proxy's 403). `WebFetch` (a separate,
  more-permitted channel) COULD reach [www.talentrah.com](https://www.talentrah.com) and
  `api.github.com`, so a content-level (not pixel-level) read-only pass of
  production and a check of open GitHub issues/PRs were both possible.
  If a future run has the same restrictions, don't re-spend time on
  `db:local`, on getting `next build` to succeed, or on reaching the shared
  dev project's host directly — go straight to: static checks (build via
  `next dev` for a quick manual smoke render if truly needed, but prefer
  typecheck+lint+audit as the reliable signal), `mcp__Supabase__*` for
  advisories/migrations/read-only queries, `WebFetch` for production
  content and GitHub issues/PRs, and pure code review for the rest. If
  these restrictions are gone in a later run, this whole section is stale —
  check the proxy status output fresh rather than trusting this list
  indefinitely.
- One dead end worth recording so it isn't re-chased: while investigating
  the JSON-parse error above, `/signup`'s form appeared to sometimes wipe
  First name/Last name/Email/Country the moment the Password field was
  filled via Playwright's `.fill()` (a single synthetic `input` event, the
  same shape a password-manager autofill or paste produces) — but it did
  **not** reproduce via real keystroke-by-keystroke typing
  (`pressSequentially`), and stopped reproducing at all once the `/signup`
  route had been hit a few times (i.e. once Next dev's on-demand
  compilation for that route was warm). Per this repo's own documented rule
  ("a test failure reproduced only under `npm run dev` … reproduce it again
  against `npm run build && npm run start` first"), and since `next build`
  couldn't run here at all (see above), this was **not filed as a finding**
  — it could not be confirmed as a real bug rather than a dev-mode/
  first-compile artifact. If a future run has real `next build` access and
  a spare few minutes, it would be worth 5 minutes of Playwright
  `.fill()`-on-password testing against a genuinely built-and-started app to
  close this out one way or the other; `src/components/auth/signup-form.tsx`
  already has substantial, deliberate handling for a related React-19
  form-action native-reset quirk (see its own top-of-file comment), which is
  the first place to look if it's ever confirmed real.

### Static / security pass

- `npm ci`, `npx next typegen`, `npx tsc --noEmit`: clean, zero errors.
- `npm run lint`: 13 pre-existing warnings (unused vars in test files and
  two auth-action placeholder params), zero errors — matches CLAUDE.md's own
  note that this repo carries pre-existing lint warnings elsewhere. Not
  re-reported as new.
- `npm audit`: 0 vulnerabilities.
- `npm run build`: could not complete in this sandbox (see environment
  limitations above — `fonts.googleapis.com` blocked). Not a code finding.
- `mcp__Supabase__get_advisors` (security) on production
  (`nytwbbzfpytctjsoczzq`): 16 `rls_enabled_no_policy` (INFO) — all on
  admin/internal tables (`admin_audit_log`, `admin_roles`, `admin_users`,
  etc.) that are deliberately default-deny with no client-facing policy at
  all; expected shape per CLAUDE.md's admin-auth model, not a finding. 52
  `pg_graphql_anon_table_exposed` + 52 `pg_graphql_authenticated_table_exposed`
  (WARN) — already investigated and written up in
  [docs/pg-graphql-investigation.md](pg-graphql-investigation.md): real but
  low-severity (schema discoverability only, RLS still gates actual rows
  over GraphQL identically to REST), and the approved remediation is
  confirmed unexecutable on hosted Supabase by any tool a project owner has.
  Not re-reported. 13 `anon_security_definer_function_executable` + 29
  `authenticated_security_definer_function_executable` (WARN) — expected
  given this project's architecture leans on `SECURITY DEFINER` functions
  with deliberate, individually-reasoned `EXECUTE` grants throughout
  (CLAUDE.md's own documented pattern); no individual function checked here
  looked mis-scoped, but this count (42) is worth a future run diffing
  against if it grows unexpectedly rather than re-auditing all 42 from
  scratch every time. **One genuinely new item, not previously documented
  anywhere in this repo: `auth_leaked_password_protection` (WARN) —
  Supabase Auth's leaked-password (HaveIBeenPwned) check is disabled on
  production.** This is a one-toggle Auth setting (Authentication → Policies
  in the Supabase dashboard, or the Auth config management API), not a
  migration or code change, and outside what `execute_sql`/MCP tooling here
  can flip — recommending the founder enable it directly. Low severity (a
  hardening recommendation, not an active exploit), so not written up as a
  separate escalation file — recorded here in full instead.
- Performance advisors: not checked this run — time-boxed out; a future run
  should cover both security and performance each time per the task's own
  instructions.

### Code review — diff since [no prior entry — used last ~48h of commits on `main`]

Reviewed every file touched in that window against the standing checklist
(atomic gates, unchecked deletes/updates, new/changed RLS policies and their
`TO`/`EXECUTE` implications, new columns on user-writable tables, migration
numbering/additivity).

- **Three new migrations landed in the window, all already applied to both
  `nytwbbzfpytctjsoczzq` (production) and `dozaffzgqkbarxtlclsj`**
  (confirmed via `list_migrations` on both): `0182_gate_screening_assessment_public_read.sql`
  (closes a real public-read RLS drift on three tables whose policies had
  silently stopped matching `job_postings`' own, now-more-complex visibility
  rule — well-reasoned, joins back to the source of truth rather than
  reimplementing it, and explicitly re-checked all other `roles: {public},
  qual: true` policies in the schema for the same pattern before concluding
  it was the only three), `0183_plus_pack_credit_count_fix.sql` (45→50
  credits on the Plus pack to match its own marketing copy; confirmed zero
  past purchases at the old value, so nothing to backfill), and
  `0184_mentor_display_name.sql` (adds a mentor-settable display name,
  correctly column-granted per the 0133/0030 discipline — additive grant
  only, no `revoke`-then-`grant` that would have wiped 0142's/0174's own
  columns — and correctly re-creates both reader functions with `EXECUTE`
  revoked from `anon`/`public` and granted only to `authenticated`). All
  three read as exemplary against this repo's own rules; no issues found.
- **`src/lib/notifications/proactive-match-alert/template.ts`** (touched
  this window): still calls `describeMatchConfidence` correctly, not a
  bespoke `${score}%` string — verified by direct inspection (the standing
  `tests/lib/match-confidence-enforcement.test.ts` needs the DB-target
  guard, which this sandbox's auto-mode classifier declined to bypass even
  with the repo's own documented `ALLOW_TESTS_AGAINST_HOSTED=yes-i-mean-it`
  escape hatch — a future run with that permission available should prefer
  running the real test over the manual grep this run fell back to).
- **Medium finding, fixed — PR pending (see below):** `deleteAvailabilitySlotAction`
  in `src/lib/mentorship/actions.ts` (pre-existing since PR #341,
  2026-09-10; not part of this window's diff, but found while reading the
  file for an unrelated reason) discarded the Supabase `.delete()` result
  entirely — no `{ error }` destructured, no check. This is exactly
  CLAUDE.md's own documented incident shape ("A Supabase delete that is
  rejected does NOT throw — it resolves with an `error`"): a genuine query
  failure (as opposed to the legitimate zero-rows no-op the function's own
  comment already correctly reasons about, for a booked slot) would silently
  report success to the caller. Fixed to check `error` and throw, matching
  the sibling `postAvailabilitySlotAction` in the same file; the one UI
  caller (`src/app/(app)/mentorship/apply/availability-manager.tsx`) now
  catches it and shows an inline error instead of letting it escape as an
  unhandled rejection. Verified: `npx tsc --noEmit` and `npx eslint` clean
  on both files. **Could not run the DB-backed unit/e2e suite in this
  sandbox** (see environment limitations above) — no existing test covered
  this action either way; relying on CI's own ephemeral-Postgres `checks`
  job to give the real signal on the PR. RLS double-checked separately
  (0133's own "a mentor removes their own still-open slots" DELETE policy
  already scopes this correctly; the fix doesn't touch authorization, only
  error visibility).
- No other unchecked-delete, read-then-write balance/counter, or
  missing-`TO`-clause patterns found in this window's diff.

### Dynamic QA/UX pass

Golden-path smoke pass and the Monday rotation (job feed & matching) were
both planned but **blocked by the environment limitations above** — no
DB-backed local server, no reachable production browser session. What
substitute coverage happened: read-only content review via `WebFetch` of
[www.talentrah.com](https://www.talentrah.com)'s homepage (renders the expected hero, copy, and feature
set; no pixel-level design-system check was possible without a real
browser). No UX/design findings recorded this run for that reason — not a
"found nothing" clean bill, an actual gap, flagged so it isn't mistaken for
one. Recommend a future run with working DB/browser access repeat the
Monday-rotation deep pass on job feed & matching specifically, since it
hasn't been covered by this practice yet at all.

### GitHub issues/PRs checked

- **Issue #151** ("Soft sign-in prompt for signed-out visitors") —
  deliberately deferred, scope written down on purpose, no action needed;
  confirmed still open with no new comments.
- **Issue #156** ("tracker-and-farah: intermittent FK failures from a
  vanished shared-owner profile") — open/reopened; hit GitHub's
  unauthenticated API rate limit while trying to pull its full body this
  run (repeated 403s from `api.github.com` after the first couple of
  calls) — recorded as still-open-and-untriaged-by-this-run rather than
  guessed at from the title alone. A future run should pull its full body
  before assuming anything about current status.
- **PR #443** ("Write the missing migration for the Pass price increase,
  sync catalog.ts", branch `fix/pass-price-increase-migration`) — corrected
  by send-450's own independent check before this entry was committed:
  this PR is **merged** (2026-09-17), and its migration
  (`0169_pass_price_increase.sql`) matches what's already live on
  `main`/production/dev. Nothing left here for the founder to look at —
  recorded only so a future run doesn't re-flag it.
- **Branch `feat/facet-count-rpc-consolidation-441`** (no PR checked this
  run, but its migration `0185_landing_page_facet_count_rpc` is already
  applied to `dozaffzgqkbarxtlclsj`, not yet to production, not yet
  merged) — consistent with, not a violation of, the additive-before-merge
  workflow; noted here only so a future run recognizes 0185 as "known,
  in-flight" rather than an unexplained gap between the two projects'
  migration lists. (Resolved since this run: merged as PR #531/send-441.)
- **Branch `fix/lighthouse-ci-silent-exit-bug`** — resolved since this run:
  merged as PR #532/send-443 and deleted (confirmed via `git ls-remote`
  returning nothing for it). No longer a loose end.

### Fixed this run

- `src/lib/mentorship/actions.ts` + `src/app/(app)/mentorship/apply/availability-manager.tsx`:
  unchecked-delete-error fix described above. Branch
  `fix/mentor-availability-delete-error-check-qa-audit`; landed via
  send-450 as PR #536.

### Escalated this run

- Nothing written to `docs/qa-audit/` this run — no Critical/High findings,
  and the one Medium finding was well-scoped enough to fix directly per the
  task's own triage rule. The leaked-password-protection Auth setting is
  recorded above in full rather than as a separate file, since it's a
  one-line, low-severity, one-toggle recommendation.
