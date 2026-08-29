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
compromised (phishing, or an OAuth identity linked to their address) still
leads to admin access, because that is the credential. What a fully separate
credential store would have bought is exactly that, and it is the thing to
revisit — with MFA on the Supabase account being the cheaper first move —
rather than a gap that was overlooked.

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
`/api/admin` that a *human* operates — `moderate-scholarship`,
`moderate-campaign`, `moderate-job-posting`, and the `scholarships` POST — are
the ones whose shared secret is the wrong mechanism, because it is why all
three record `reviewed_by = null`. Those move to admin sessions in **M2**, when
there are screens driving them. Until then `/admin/scholarships/new` sits
behind the new guard *and* still asks for the shared secret; that double ask is
honest rather than tidy, and M2 removes the second half.

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

There is no self-serve path. Admin is granted by someone holding the
service-role key:

```bash
npm run grant-admin -- someone@talentrah.com "Their Name"
npm run grant-admin -- --list
npm run grant-admin -- --revoke someone@talentrah.com
```

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
- **No MFA.** The single strongest improvement available, and it is a Supabase
  project setting plus an `aal2` check, not a schema change.
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
