# Admin auth (M1)

Read this before touching anything under `/admin`, `src/lib/admin/`, or
migration 0060. It records the two decisions the admin-dashboard plan left open
at M1's kickoff, what was measured before choosing, and the parts that are
deliberately not built yet.

## Decision 1 — a separate `admin_users` table, not `profiles.is_admin`

**Chosen: (b), with the credential store shared.** Identity and session live in
their own tables (`admin_users`, `admin_sessions`, `admin_audit_log`, all
0060), reachable only by the service role. Supabase Auth still holds the
password.

### Why not the flag on `profiles`

It would have worked on the day it shipped. 0030 revoked table-level `UPDATE`
on `profiles` and granted back five named columns, so a new `is_admin` column
would not be writable by `authenticated` the moment it was added — checked, not
assumed.

The objection is that its safety would be **a property of a grant list on a
table that exists to grow**. `profiles` is the most user-writable table in the
schema; its column grants were written specifically so the Settings screen
could widen them; and this mechanism has produced four live findings here
(0026, 0027, 0028, 0030). CLAUDE.md's own standing rule is that a value-bearing
column added to a user-writable table should fail
`tests/rls/column-privileges.test.ts` until someone decides deliberately.
`is_admin` is the most value-bearing column that could exist in this schema, so
the deliberate decision is: not on that table.

The new tables have **RLS on with no policies at all, and every privilege
revoked from `anon` and `authenticated`**. Both, on purpose — a missing policy
is undone by adding one, a missing grant has to be restored in SQL, in a diff.
Measured against the CI project after applying 0060:

```
authenticated select admin_users      -> refused: permission denied for table admin_users
authenticated insert admin_users      -> refused: permission denied for table admin_users
authenticated exec  admin_session_validate -> refused: permission denied for function admin_session_validate
anon          select admin_sessions   -> refused: permission denied for table admin_sessions
```

### Why not a fully separate credential store

The plan's stronger option was an `admin_users` table with its own password
hash, so a bug anywhere in consumer auth could never grant admin. That buys
real isolation and costs hand-rolled password hashing, session issuance,
rotation, reset and rate limiting. On this codebase's evidence the likeliest
source of a live vulnerability is our own security code, not Supabase Auth's.

So the split is:

| Layer | Where it lives | Consequence |
|---|---|---|
| Credential | Supabase Auth | No hand-rolled crypto. |
| Authorisation | `admin_users` | No consumer session, however privileged, can read or write it. |
| Session | `admin_sessions` | Ours. Revocable, 8-hour TTL, independent of `sb-*`. |

**The residual risk, stated plainly:** an admin's Supabase account being
compromised (phishing, or an OAuth identity linked to their address) reaches
admin access, because that is the credential. A fully separate credential store
would have bought immunity to that. MFA was the intended answer and is **not
in place** — it was built in `0068` and removed again in `0071` before any
operator enrolled. See **Second factor** below.

**That risk widened on 2026-08-29, and the shape of it changed.** The seeker
forgot-password flow shipped, calling `resetPasswordForEmail`, which operates
on any `auth.users` row. There is no admin exclusion and there should not be
one: a reset form that behaved differently for an operator's address would be
an enumeration oracle for exactly the accounts that most need not to be
enumerable, and it would leave a locked-out operator with no recovery at all.

So:

| | changing an admin password requires |
|---|---|
| before | service-role access, or the Supabase dashboard |
| after | access to that admin's email inbox |

That is the ordinary consequence of email-based recovery and it is not a
defect in the seeker flow. It matters here because the account it recovers is
privileged.

**This is an accepted, deferred risk — not an oversight.** There is no second
factor on any admin account. An admin's password is resettable through the
seeker forgot-password flow, so whoever controls an operator's mailbox controls
their admin access, and nothing in `/admin` stands in the way. Both production
operators are in exactly that position today.

What follows from that, practically: an admin address should be on an account
with its own strong protection (the mailbox provider's 2FA is doing the work
that `/admin` is not), and `admin_users` should be kept short — every row is a
mailbox that grants operator access.

### What being signed in to the seeker app gets you

Nothing. `/admin/login` verifies the password with a Supabase client that
persists nothing (`src/lib/admin/actions.ts`), so no `sb-*` cookie is written
and no admin code path ever calls `supabase.auth.getUser()`. A stolen seeker
session is not a way into `/admin`; reaching it means logging in again, at a
different door, and produces a row that can be revoked from the database.

### Attribution

`admin_users.id` **is** the `auth.users` id, which is also the `profiles` id.
That is load-bearing: `ad_campaigns.reviewed_by` is a foreign key to
`profiles`, and it is hardcoded `null` today precisely because a shared secret
cannot name a reviewer. Isolating the authorisation record did not require a
second id space, and inventing one would have broken the only attribution
column that already exists.

`scholarships` and `job_postings` have `moderated_at` / `removed_at` but **no
`*_by` column at all** — M2 needs a small migration to add them.

## Second factor — built, then deferred (0068, reverted by 0071)

**There is no second factor. `/admin` is email and password only.**

TOTP was built in `0068`: enrolment forced by the route guard, a code required
at `/admin/login`, and a peer-reset path in `scripts/grant-admin.ts`. It was
removed in `0071` before a single operator completed enrolment, and removed
whole rather than switched off — no gate, no login check, no dormant column.
A half-disabled feature would leave the next person to read this working out
which half was live.

**Why it is recorded here rather than deleted from the doc.** The reasoning
that motivated it has not stopped being true: the risk in **The residual risk**
above is real and is now simply accepted. Anyone picking this up again should
know the work existed and what it turned on.

**The one finding worth keeping**, because it was measured against the live API
rather than assumed, and it is what any future attempt would rest on:

```
mfa.unenroll from an aal1 session   422  AAL2 required to unenroll verified factor
```

That is the property that made TOTP worth having — an attacker who resets a
password reaches `aal1` and cannot remove the factor from there, so the reset
path stops being sufficient on its own. It is also why enrolment could not be
blocking at login: with no recovery codes, and `unenroll` needing the very
assurance level a locked-out operator cannot reach, a hard block would have
been a deadlock for every admin that existed at the time.

**Migration bookkeeping.** `0071` dropped the column. CI's ledger carries two
extra rows from it (`drop_admin_mfa`, then
`restore_admin_mfa_column_pending_pr143`) that have no file in
`supabase/migrations/` — they are a premature apply and its undo, they cancel
out, and nothing is pending. Production has only the real row. See
`supabase/migrations/README.md` for why they were left rather than tidied away.

**What was NOT reverted**, and should not be confused with this:

- `0067`'s `operator_credential_events` and `/admin/ops`. That reads GoTrue's
  own event log and is about audit visibility. It is unrelated to whether a
  second factor exists and keeps working unchanged.
- `auth.mfa_factors`. Production holds one **unverified** TOTP factor from an
  enrolment started and abandoned on 2026-08-30. Unverified factors do not
  raise the assurance level, so it neither blocks nor protects a login. It was
  left alone deliberately: removing an auth-schema row is its own decision, not
  a side effect of dropping a public column.

## Decision 2 — the cron routes keep the shared secret

**They are not migrated, and nothing in M1 touches them.**

`ingest-jobs`, `ingest-scholarships`, `renew-passes`, `charge-campaigns` and
`estimate-llm-costs` are triggered by Vercel Cron and by an operator with
`curl`. There is no browser, no cookie jar and nobody to click a login form;
Vercel sends a fixed `Authorization: Bearer <CRON_SECRET>` that is not ours to
change. A session cookie cannot authenticate a caller that has no session, so
"migrating" them would mean either breaking the schedule or minting a
long-lived session for a machine — a shared secret again, with more moving
parts and an expiry that can silently stop a nightly job.

**The split that matters is by caller, not by URL prefix.** The routes under
`/api/admin` that a *human* operated — `moderate-scholarship`,
`moderate-campaign`, `moderate-job-posting`, and the `scholarships` POST — were
the ones whose shared secret was the wrong mechanism, because it is why they
recorded `reviewed_by = null`.

**Those four are now gone.** M2 built the screens, and the routes were deleted
rather than left running beside them:

| retired route | what an operator uses instead | what it calls |
|---|---|---|
| `GET/POST /api/admin/moderate-job-posting` | `/admin/reports` | `decideJobPostingAction` → `admin_moderate_job_posting` |
| `GET/POST /api/admin/moderate-scholarship` | `/admin/scholarships` | `decideScholarshipAction` → `admin_moderate_scholarship` |
| `GET/POST /api/admin/moderate-campaign` | `/admin/campaigns` | `decideCampaignAction` |
| `POST /api/admin/scholarships` | `/admin/scholarships/new` | `createScholarshipAction` |

Deleting them was the point, not tidiness. While both existed, a shared secret
and a session were two ways to reach the same write, and the weaker one set the
real security level — `reviewed_by = null` would have stayed reachable for
anyone holding the env var, next to a screen that records the operator properly.
The double ask on `/admin/scholarships/new` is gone too: that page is inside
`(protected)` and no longer has a password field.

`requireAdminSecret` itself **stays**, and is still the right mechanism for the
callers that have no browser: `ingest-jobs`, `ingest-scholarships`,
`renew-passes`, `charge-campaigns` and `estimate-llm-costs`. Nothing scheduled
changed.

## How it fits together

```
GET /admin/anything
  └─ src/proxy.ts            no admin cookie present?  -> 302 /admin/login?redirectTo=…
  └─ (protected)/layout.tsx  requireAdmin()
        └─ admin_session_validate(sha256(cookie))   one statement, four conditions
              token matches ∧ not revoked ∧ not expired ∧ admin not disabled
```

The proxy check is a **courtesy, not the gate** — it only proves a cookie is
present. Verified: a forged cookie value walks past the proxy and is refused by
the layout. Deleting the proxy check would open nothing; relying on it instead
of the layout guard would open everything.

The guard is a database round trip on every admin navigation, deliberately: a
cached "yes" is a revocation that does not take effect.

`admin_session_validate` is **one** `UPDATE … FROM … RETURNING`. A select
followed by an update in TypeScript would be the same read-then-act shape that
let `spendCredits` double-spend before 0035.

## Provisioning

There is no self-serve path to BECOMING an admin. Admin is granted by someone
holding the service-role key:

```bash
npm run grant-admin -- someone@talentrah.com "Their Name"
npm run grant-admin -- --list
npm run grant-admin -- --revoke someone@talentrah.com
```

`--reset-mfa` used to sit alongside these. It went with the feature in `0071`;
there is no authenticator left to reset.

**Accepted risk, stated rather than solved:** with a single admin this is a
lockout. Two operators exist today, so either can rescue the other.

If the address has no Talentrah account, the script creates one — but only with
`NEW_ADMIN_PASSWORD` set in the environment, never as an argument, because an
argument lands in shell history and this repo is public.

**WHICH PROJECT IT TARGETS IS WHATEVER `.env.local` POINTS AT, and that is now
CI.** The script reads `.env.local` only. Since `.env` was deleted on
2026-08-29 there is no production credential on disk by default, so running
this locally grants admin on the **CI** project — which is almost never what
someone typing it means.

For production, use the Supabase MCP connector and do the same upsert directly:
look up the id in `auth.users` by lower(email), then upsert
`{id, lower(email), display_name, disabled_at: null}` into `admin_users`. That
is exactly what the script does, and it reaches production without a
`service_role` key ever landing on disk. The first production admin was
provisioned that way.

`--revoke` sets `disabled_at` and revokes every live session; it does **not**
delete the row, because the audit trail names it.

## Known gaps, not oversights

- **Login brute-force protection is Supabase's per-IP limit, and the IP is
  ours.** `signInWithPassword` is called server-side, so the limit is shared by
  every caller rather than per-attacker. The seeker login
  (`src/lib/auth/actions.ts`) has had this property since it shipped, so this
  is not new exposure — but a limiter keyed on the caller's own IP, against
  `api_rate_limits` (0038), is the real fix and is not in M1.
- **THERE IS NO SECOND FACTOR AT ALL.** Every admin is password-only, and an
  admin password is resettable through the seeker forgot-password flow — so
  control of an operator's mailbox is control of `/admin`. `0068` built TOTP
  and `0071` removed it before anyone enrolled; this is a deferred decision,
  not a gap nobody noticed. The practical mitigation lives outside this
  codebase: keep `admin_users` short, and put admin addresses on mailboxes that
  have their own 2FA.
- **`auth.audit_log_entries` is EMPTY on the CI project** — zero rows, ever,
  while production holds 44,822. Anything that reasons about GoTrue auth events
  is therefore untestable in CI: `0067`'s function has real data to filter on
  production and nothing at all on CI, so its negative assertions pass there
  trivially and its positive control skips (loudly, by design). Two ways to
  mint a fixture event do not exist either — `generateLink` writes no audit
  entry, and the service role cannot INSERT into the `auth` schema. Root cause
  unknown and deliberately not investigated; recorded so the next person
  testing anything against `auth.*` does not rediscover it from a green suite
  that proved nothing.
- **Expired `admin_sessions` rows are never swept.** They are inert — the
  validator refuses them — so this is housekeeping, not a leak.
- **The admin cookie is scoped to `path=/admin`,** so a future `/api/admin/*`
  route cannot read it. M2's screens are Server Actions, which post back to the
  `/admin` URL they were rendered from, so they are fine. Widening the path is
  a deliberate change, not something to discover by debugging a 401.
- **`admin_users.email` can drift from `auth.users.email`.** Nothing
  authenticates against it — login resolves the admin by id — so drift only
  affects the display name and the failed-login audit lookup.

## Verification run for M1

Against the CI project (`dozaffzgqkbarxtlclsj`) and the local dev server:

- `admin_session_validate` returns the identity for a live session and **no
  row** for each of: unknown token, revoked, expired, and live-but-disabled
  operator. All four checked separately.
- Every table and the function refuse `anon` and `authenticated` (output
  above).
- `/admin`, `/admin/scholarships/new` and a non-existent `/admin/*` path all
  redirect to `/admin/login` carrying an encoded `redirectTo`.
- `?redirectTo=//evil.example/x` and `?redirectTo=/jobs` are both dropped;
  `?redirectTo=/admin/scholarships/new` is carried into the form's hidden
  field.
- A wrong credential returns "Incorrect email or password." and sets no cookie.
- A forged cookie is refused by the layout guard.
- With the database unreachable the guard **refuses** rather than opening —
  observed directly, because the local `.env.local` has a placeholder
  service-role key.

**Not run at the time:** the full signed-in click-through. `.env.local` then
held a placeholder `SUPABASE_SERVICE_ROLE_KEY`, so nothing service-role worked
in a local process.

*Resolved 2026-08-29.* A real CI key is in place, the full suite runs locally
(and its teardown sweep now actually deletes, which it had never done), and the
first production admin exists — provisioned through the connector rather than
the script, for the reason in **Provisioning** above.
`tests/rls/admin-identity.test.ts` covers the database half in CI.
