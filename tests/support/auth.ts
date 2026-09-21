import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import type { Database } from "@/lib/supabase/types";
import { RUN_TAG } from "./list-users";

/**
 * Shared throwaway-account helper for the integration suites.
 *
 * WHY THIS EXISTS. Every suite here runs against the one real Supabase project,
 * and Supabase Auth rate-limits its admin endpoints. Once the referral and
 * tracker suites landed, a full CI run created enough fresh accounts in a
 * burst to trip it — and the failure is genuinely confusing, because it does
 * not surface as "rate limited": the account simply isn't created, so a later
 * assertion fails with something like "expected [] to have a length of 1" in
 * a completely unrelated suite whose fixture user never existed. One CI run
 * failed six tests across three files that way, none of which had anything
 * wrong with them.
 *
 * Two mitigations, both needed at the time:
 *   1. RETRY with backoff here, so a transient limit costs seconds not a run.
 *   2. Create FEWER users — the retry only buys headroom, it does not create
 *      budget. Suites should seed state directly with the service role wherever
 *      a real session isn't the thing under test, and share one user across
 *      cases that don't need isolation.
 *
 * Neither was enough, because the call being limited was `verifyOtp` and no
 * amount of backoff fits inside a 60s hook. `sessionFor` no longer logs in at
 * all — see the note on it.
 *
 * send-453 — `createTestUser` NO LONGER mints a fresh account on every call.
 * It claims a reused identity from `test_user_pool` (migration 0188) first,
 * and only creates a genuinely new `auth.users` row when the pool is empty or
 * fully leased (see `claimFromPool`'s own header below) — so the rate-limit
 * pressure this section describes is now the OVERFLOW case, not the common
 * one. `withRateLimitRetry` still earns its place for that overflow path and
 * for the pool's own initial self-seeding, but a warm pool hits it rarely.
 */

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;

export type DB = SupabaseClient<Database>;

export const admin: DB = createClient<Database>(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function isRateLimited(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /rate limit/i.test(message);
}

/**
 * Retries only a rate-limit failure; anything else is a real error, thrown
 * as-is.
 *
 * THE BACKOFF IS BOUNDED BY THE HOOK TIMEOUT, not by what would be ideal.
 * These calls run inside `beforeAll`, and vitest.config.ts allows a hook 60
 * seconds. 3+6+12+24 is 45s of waiting across four attempts, which leaves
 * headroom for the calls themselves. A backoff long enough to ride out a
 * multi-MINUTE limit window cannot live here — it would fail the hook before
 * it ever finished waiting.
 *
 * So this rides out a short burst limit and nothing longer. That is a real
 * ceiling on what retrying can fix, and the reason the note below about
 * creating fewer sessions is not just tidiness.
 */
async function withRateLimitRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRateLimited(err)) throw err;
      lastError = err;
      await new Promise((r) => setTimeout(r, 3000 * 2 ** i));
    }
  }
  throw lastError;
}

export interface TestUser {
  id: string;
  email: string;
}

/**
 * ── send-453: A FIXED, REUSED POOL INSTEAD OF create-THEN-delete ───────────
 *
 * Measured directly (CLAUDE.md's send-441-follow-up entry): local/agent runs
 * against the shared `dozaffzgqkbarxtlclsj` were producing 1,564
 * `user_deleted` + 559 `user_signedup` auth-audit events in a single 24h
 * window. `db:local` (an ephemeral Postgres per run, the same mechanism CI's
 * own `.github/actions/local-supabase` already uses) was the lower-risk
 * alternative and was checked first — it needs Docker, and Docker is not
 * merely "off" on the machine this was investigated from, it is not
 * installed at all (no `docker`, no Docker Desktop, no Colima/Podman/Lima),
 * which is the actual, checked reason `db:local` cannot be made the default
 * rather than an assumption that it can't.
 *
 * So this file's create/delete cycle is replaced with a claim/release cycle
 * against migration 0188's `test_user_pool` table — `claim_test_pool_user`
 * atomically hands out one already-existing, already-reset auth user
 * (`FOR UPDATE SKIP LOCKED`, so two concurrent processes/sessions can never
 * claim the same row or block on each other), and `deleteTestUsers` releases
 * it back rather than deleting it. `createTestUser`'s signature and return
 * shape are UNCHANGED — every one of the dozens of existing call sites needs
 * no edit at all, because the pooled user is re-labelled with the caller's
 * own `prefix` and a fresh random suffix, indistinguishable from a genuinely
 * new account to anything reading `TestUser.email`.
 *
 * WHAT "RESET" COVERS. `claim_test_pool_user` (0188) wipes every row in
 * every table with a direct foreign key to `auth.users.id`/`profiles.id` —
 * resumes, applications, credit ledger entries, referrals, and so on — via
 * catalog introspection, so it can't silently miss a table added later. It
 * deliberately does NOT reach through a second FK hop (an org's job
 * postings, a posting's assessment files) — those are owned via
 * `organizations`/`job_postings`, not the user directly, and every suite
 * that creates one already cleans it up itself (`deleteOrgsCascade` and
 * friends) regardless of whether the auth user is pooled or fresh. That
 * discipline predates this change and this change does not touch it.
 *
 * OVERFLOW, NOT BLOCKING. If the pool is empty and below `POOL_MAX_SIZE`,
 * a fresh user is created and ADDED to the pool for future reuse (the pool
 * self-seeds; nothing needs to pre-populate it). If the pool is already at
 * `POOL_MAX_SIZE` and every row is genuinely leased (heavy concurrent load),
 * `claimFromPool` returns null and the caller falls back to creating a
 * plain, unpooled throwaway user exactly as before this change — a run
 * never waits on the pool and never fails because of it.
 *
 * STALE LEASES SELF-HEAL. `claim_test_pool_user`'s own `WHERE leased_by IS
 * NULL OR leased_at < now() - stale_after` treats an abandoned lease (a
 * process killed mid-test, the same failure mode fixture-accounts.ts's own
 * header documents for the unpooled path) as available again after
 * `POOL_STALE_AFTER_SECONDS` — no separate sweep needed, and
 * `release_test_pool_user` only clears a lease it can prove `p_lease_id`
 * (this file's `RUN_TAG`) still holds, so a slow former holder finally
 * calling release cannot undo a DIFFERENT process's legitimate reclaim.
 *
 * POOL USERS ARE INVISIBLE TO THE EXISTING GLOBAL SWEEP ON PURPOSE.
 * global-teardown.ts's `sweepStaleAccounts` deletes any `@talentrah.test`
 * account older than `SWEEP_STALE_AFTER_MS` — exactly what would happen to
 * a long-lived pool member if it used that domain, undoing the pooling the
 * moment the sweep runs. Pool users are minted under `@talentrah.pool` (see
 * `POOL_EMAIL_DOMAIN` below) specifically so `TEST_ACCOUNT_DOMAIN`'s
 * `endsWith` check never matches them; they're managed exclusively by this
 * file's own claim/reset/stale-reclaim cycle.
 */

const POOL_MAX_SIZE = 40;
const POOL_STALE_AFTER_SECONDS = 600;
const POOL_EMAIL_DOMAIN = "@talentrah.pool";

async function poolSize(): Promise<number> {
  const { count, error } = await admin
    .from("test_user_pool")
    .select("user_id", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

/**
 * Tries to hand back a pooled user relabelled for this caller. Returns null
 * — never throws for "no room" — when the pool doesn't exist yet (an older
 * project not yet migrated), is fully leased at `POOL_MAX_SIZE`, or a claim
 * genuinely finds nothing (a benign race against another concurrent
 * claimant, since SKIP LOCKED means "try the next" rather than "wait").
 */
async function claimFromPool(prefix: string, meta?: Record<string, unknown>): Promise<TestUser | null> {
  const email = `${prefix}-${randomUUID()}${POOL_EMAIL_DOMAIN}`;

  const { data: claimed, error: claimErr } = await admin.rpc("claim_test_pool_user", {
    p_lease_id: RUN_TAG,
    p_prefix: prefix,
    p_new_email: email,
    p_stale_after_seconds: POOL_STALE_AFTER_SECONDS,
  });
  // A project that hasn't run migration 0188 yet (e.g. an older local
  // db:local snapshot) simply doesn't have this function — fall back to the
  // pre-pool behaviour rather than failing every suite outright.
  if (claimErr) {
    if (/function .*claim_test_pool_user.* does not exist/i.test(claimErr.message)) return null;
    throw claimErr;
  }

  let userId = claimed as string | null;

  if (!userId) {
    if ((await poolSize()) >= POOL_MAX_SIZE) return null; // fully leased under load — overflow to a fresh user.

    const { data, error } = await withRateLimitRetry(() =>
      admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: meta }).then((r) => {
        if (r.error) throw r.error;
        return r;
      }),
    );
    if (error) throw error;
    userId = data.user!.id;

    const { error: addErr } = await admin.rpc("add_test_pool_user", {
      p_user_id: userId,
      p_lease_id: RUN_TAG,
    });
    if (addErr) throw addErr;
    return { id: userId, email };
  }

  const { error: renameErr } = await admin.auth.admin.updateUserById(userId, {
    email,
    email_confirm: true,
    user_metadata: meta ?? {},
  });
  if (renameErr) throw renameErr;

  // `updateUserById` above only touches `auth.users.raw_user_meta_data` —
  // `handle_new_user` (the trigger that copies first_name/last_name/country
  // out of that metadata into `profiles`) fires on INSERT only, and this is
  // an UPDATE against an already-existing row. A genuinely new (overflow)
  // user gets this for free via the trigger; a reused pool user does not,
  // so it's applied explicitly here — otherwise `meta` silently stops doing
  // anything the moment a caller's user happens to come from the pool
  // instead of overflow. Caught by referral-leaderboard.test.ts's own
  // "B never set a custom display name — falls back to first_name" case,
  // which creates its fixture via `createAuthedTestUser(prefix, { first_name })`
  // and asserts on that exact fallback.
  if (meta && ("first_name" in meta || "last_name" in meta || "country" in meta)) {
    const profileFields: { first_name?: string; last_name?: string; country?: string } = {};
    if (typeof meta.first_name === "string") profileFields.first_name = meta.first_name;
    if (typeof meta.last_name === "string") profileFields.last_name = meta.last_name;
    if (typeof meta.country === "string") profileFields.country = meta.country;
    const { error: profileErr } = await admin.from("profiles").update(profileFields).eq("id", userId);
    if (profileErr) throw profileErr;
  }

  return { id: userId, email };
}

/**
 * Creates (or, per the header above, claims and relabels a pooled) confirmed
 * throwaway account. `prefix` should identify the suite so a leaked/traced
 * account is attributable to the file that used it.
 */
export async function createTestUser(
  prefix: string,
  meta?: Record<string, unknown>,
): Promise<TestUser> {
  const pooled = await claimFromPool(prefix, meta);
  if (pooled) return pooled;

  const email = `${prefix}-${randomUUID()}@talentrah.test`;
  const { data, error } = await withRateLimitRetry(() =>
    admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: meta }).then((r) => {
      if (r.error) throw r.error;
      return r;
    }),
  );
  if (error) throw error;
  return { id: data.user!.id, email };
}

/** How long a minted test token is valid. A suite is over long before this. */
const SESSION_TTL_SECONDS = 900;

/**
 * The claims a Supabase access token carries, as this project's database
 * actually reads them.
 *
 * A REAL GoTrue TOKEN CARRIES MORE THAN THIS, and the difference was checked
 * rather than assumed. Decoding a live session cookie from a browser login
 * gives: aal, amr, app_metadata, aud, email, exp, iat, is_anonymous, iss,
 * phone, role, session_id, sub, user_metadata. Everything omitted below is
 * GoTrue's own bookkeeping.
 *
 * What matters is what reads them on the other side. Against the live CI
 * database, `pg_policy` and `pg_proc` contain ZERO references to `auth.jwt()`
 * or `auth.email()`; 55 uses of `auth.uid()` (which reads `sub`) and two
 * functions using `auth.role()` (which reads `role`), both only to check for
 * `service_role`, which an authenticated token fails here exactly as a real
 * one does. PostgREST itself reads `role`, `aud` and `exp`. So the set below
 * is not a convenient subset — it is every claim anything in this system looks
 * at, and a token carrying it is indistinguishable to Postgres from a real one.
 */
function claimsFor(userId: string, email: string, now: number) {
  return {
    sub: userId,
    role: "authenticated",
    aud: "authenticated",
    email,
    iss: `${URL}/auth/v1`,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  };
}

/** Exported for the equivalence probe only — not used by the suites. */
export const __claimsForTesting = claimsFor;

async function userIdForEmail(email: string): Promise<string> {
  const { data, error } = await admin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`no profile for ${email}; cannot mint a session without a subject`);
  return data.id;
}

/**
 * An authenticated client for a user.
 *
 * WHY THIS SIGNS A TOKEN INSTEAD OF LOGGING IN. It used to mint a magic link
 * and redeem it with `verifyOtp`, which is a real login and was the honest
 * thing to do — but it made every suite in this repo depend on a rate-limited
 * remote endpoint that has nothing to do with what any of them assert. That
 * bill came due: `verifyOtp` is metered separately from `createUser` and
 * `generateLink`, a full CI run redeems ~48 of them in a burst, and once the
 * limit was tripped the failures landed in whichever suite happened to run
 * next — six red tests across three untouched files, none of them broken. A
 * previous fix wrapped the call in backoff; that turned hard failures into
 * near-misses (46 of 47 files, 56.5s of a 60s hook) but could not fix it,
 * because the backoff is structurally capped by the hook timeout and the limit
 * window is measured in tens of minutes.
 *
 * So the login is removed rather than retried. The token below is signed with
 * the project's own `SUPABASE_JWT_SECRET`, which is what GoTrue signs with and
 * what PostgREST verifies against — no auth request is made at all, so there
 * is nothing left to rate-limit. What the suites are testing is RLS, and RLS
 * sees a verified token and its claims; it has no way to know, and no reason
 * to care, which service produced it.
 *
 * The cost, stated plainly: this no longer exercises the login path. Nothing
 * here would catch a broken magic link, a bad redirect, or a GoTrue
 * misconfiguration. That is a real loss of coverage and it belongs to the
 * Playwright suite, which signs in through the actual UI.
 *
 * A STANDING FRAGILITY, because it is invisible from this file. The secret
 * this signs with is the project's LEGACY HS256 secret, and the CI project has
 * since rotated to an ECC signing key — in Supabase's JWT Keys UI the secret
 * below appears as a *previous key*. Previous keys are still accepted for
 * verification, which is the only reason this works, but that is a property of
 * the project's key configuration and not of anything in this repo. Someone
 * tidying up the old key in the dashboard would take every suite here down
 * with it, and nothing in the diff they were reviewing would say so.
 *
 * It will at least fail legibly rather than mysteriously: an unverifiable
 * token is refused by PostgREST as PGRST301, and the check further down turns
 * that into a named error rather than an empty result inside some unrelated
 * assertion. If that is where you have landed, this is the first thing to
 * check — confirm the legacy secret is still listed, then move to signing with
 * the current key rather than re-adding the old one.
 *
 * `userId` is optional only to keep the signature callers already use.
 */
export async function sessionFor(email: string, userId?: string): Promise<DB> {
  if (!JWT_SECRET) {
    throw new Error(
      "SUPABASE_JWT_SECRET is required to mint a test session. It is the project's " +
        "JWT signing secret (Supabase dashboard → Project Settings → API → JWT Settings) " +
        "and must be set as a CI secret for the CI project only.",
    );
  }
  const sub = userId ?? (await userIdForEmail(email));
  const token = jwt.sign(claimsFor(sub, email, Math.floor(Date.now() / 1000)), JWT_SECRET, {
    algorithm: "HS256",
  });

  const client = createClient<Database>(URL, ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  /*
   * PROVE THE TOKEN IS ACTUALLY BEING HONOURED, before handing the client out.
   *
   * The worry this started from: a token PostgREST will not accept might just
   * proceed as `anon`, and that would be invisible in exactly the tests that
   * matter most — a suite asserting "this table is write-only, selects come
   * back empty" passes perfectly when the caller is anon, for entirely the
   * wrong reason. Much of this repo's RLS coverage is negative assertions of
   * that shape, so a silent downgrade would not turn the run red, it would
   * hollow it out and leave it green.
   *
   * MEASURED, not assumed: signing with a deliberately wrong secret against
   * the CI project does NOT downgrade. PostgREST refuses the request outright:
   *
   *     PGRST301  No suitable key or wrong key type
   *               "None of the keys was able to decode the JWT"
   *
   * So the common misconfiguration — wrong or missing secret — is already
   * loud, and this check reports it in terms of the actual cause instead of as
   * a puzzling empty result inside some unrelated assertion.
   *
   * What it still genuinely catches is the narrower case a signature check
   * cannot: a token that verifies fine but does not resolve to the subject we
   * meant — a `sub` that never got a profile row, a stale id from a user
   * deleted by a previous run's cleanup, a caller passing someone else's id.
   * `profiles` is SELECT-able only by its owner (`auth.uid() = id`), so reading
   * our own row back asks Postgres directly: who do you think is calling? One
   * cheap round-trip per session against a mistake that would otherwise cost a
   * false green.
   */
  const { data: seen, error: probeError } = await client
    .from("profiles")
    .select("id")
    .eq("id", sub)
    .maybeSingle();
  if (probeError) throw probeError;
  if (seen?.id !== sub) {
    /*
     * NAME THE ACTUAL CAUSE, having checked it.
     *
     * This used to say "PostgREST is treating this token as anon — check
     * SUPABASE_JWT_SECRET" for every failure. That is one of three possible
     * causes and, on the evidence of issue #156, the least likely: the same
     * secret mints working sessions everywhere else in the same run. The
     * message sent one investigation to a config explanation and then to the
     * FK violations further down the run, neither of which was the cause, and
     * cost a full diagnostic pass. A probe that cannot see a row is not
     * evidence about the token until you know the row exists.
     *
     * The probe above reads `profiles` AS THE USER, and that table is
     * SELECT-able only by its owner — so an empty result is ambiguous by
     * construction. These two service-role reads remove the ambiguity before
     * anything is blamed.
     */
    const { data: profileRow } = await admin
      .from("profiles")
      .select("id")
      .eq("id", sub)
      .maybeSingle();
    const { data: authRow } = await admin.auth.admin.getUserById(sub);

    if (!authRow?.user) {
      throw new Error(
        `the account for ${sub} (${email}) NO LONGER EXISTS in auth.users — it was ` +
          `deleted between being created and having its session minted. Something is ` +
          `removing accounts out from under a live run; see issue #156. This is not a ` +
          `JWT problem.`,
      );
    }
    if (!profileRow) {
      throw new Error(
        `no profiles row for ${sub} (${email}), though the auth user EXISTS. ` +
          `handle_new_user should have created it inside createUser's own transaction, ` +
          `so this is either a trigger failure or a visibility gap — not a JWT problem. ` +
          `See issue #156.`,
      );
    }
    throw new Error(
      `minted session was not honoured as ${sub} — the profiles row EXISTS (read via ` +
        `the service role) but the owner-only probe came back empty, so PostgREST is ` +
        `not resolving this token to that subject. THIS one really is about the token: ` +
        `check SUPABASE_JWT_SECRET matches the project at ${URL}.`,
    );
  }

  return client;
}

/** Convenience: an account plus its session, the common case. */
export async function createAuthedTestUser(
  prefix: string,
  meta?: Record<string, unknown>,
): Promise<TestUser & { client: DB }> {
  const user = await createTestUser(prefix, meta);
  return { ...user, client: await sessionFor(user.email, user.id) };
}

/**
 * Best-effort cleanup of accounts a suite created.
 *
 * Reports rather than throws: a cleanup failure should not turn a passing run
 * red, because the assertions already passed and the accounts are disposable.
 * But it must not be SILENT. `.catch(() => {})` made a cleanup that stopped
 * working indistinguishable from one that worked, which is the same silence
 * that let the organisation leak this branch fixes survive for weeks — an
 * unchecked failure surfaces somewhere unrelated, much later, as a wrong
 * diagnosis.
 *
 * For the record, because it is the intuitive suspect and it is wrong: auth
 * rate limiting is NOT why accounts leak. Replaying this exact burst against
 * 48 leaked accounts deleted all 48 with zero failures. Accounts leak when the
 * process is killed before the hook runs at all — which is what the global
 * sweep on this branch is for.
 *
 * Logs each deletion (RUN_TAG, id, timestamp) — see #156. This is the
 * shared path most suites' teardown routes through, so it is the cheapest
 * place to leave a forensic trail for a live occurrence: if a `profiles`
 * row disappears mid-run again, these lines let you check whether the
 * deleting process's own RUN_TAG matches the one embedded in the deleted
 * account's fixture email, rather than having no record of who deleted it
 * or when.
 *
 * BOTH log lines below (the "deleting user=X" line and the failure summary)
 * use `process.stdout.write`, NOT `console.warn` — checked empirically, not
 * assumed. Vitest's default reporter (no `--reporter` flag, which is what
 * `npm test`/CI both use) silently drops `console.*` output from a hook on
 * a FULLY PASSING file; it only surfaces with `--reporter=verbose`. That is
 * exactly backwards for this: the process whose teardown deletes another
 * run's live fixture is very likely to be reported as passing itself — its
 * own assertions never touch the account it just deleted — while the
 * VICTIM file is the one that fails. A trail that only survives on the
 * failing file is not a trail. Raw stdout writes bypass Vitest's console
 * interception and print unconditionally, confirmed by direct comparison
 * of both under CI's actual invocation (`vitest run`, no reporter flag) —
 * for BOTH lines, not generalized from one to the other: the failure line
 * is arguably the more important of the two, since it is the one place
 * that would show a delete genuinely failing inside a passing file's own
 * teardown, so it got the same empirical check rather than an assumption.
 *
 * send-453 — an id that belongs to `test_user_pool` is RELEASED
 * (`release_test_pool_user`, scoped to this file's own `RUN_TAG` so a
 * stale-reclaim by another process is never undone — see the pool header
 * above `createTestUser`), not deleted; only genuine overflow ids (created
 * when the pool was already at `POOL_MAX_SIZE`) still go through
 * `admin.auth.admin.deleteUser`. Both are logged the same way, so a leaked
 * id is traceable regardless of which path handled it.
 */
export async function deleteTestUsers(ids: string[]): Promise<void> {
  if (!ids.length) return;

  const { data: poolRows, error: poolErr } = await admin
    .from("test_user_pool")
    .select("user_id")
    .in("user_id", ids);
  // Same fallback as claimFromPool: a project without migration 0188 yet
  // just has no pool at all, so every id is treated as unpooled below.
  const pooledIds = new Set(
    poolErr && /relation .*test_user_pool.* does not exist/i.test(poolErr.message)
      ? []
      : (poolRows ?? []).map((r) => r.user_id),
  );
  const toRelease = ids.filter((id) => pooledIds.has(id));
  const toDelete = ids.filter((id) => !pooledIds.has(id));

  const releasedAt = new Date().toISOString();
  for (const id of toRelease) {
    process.stdout.write(`[test-cleanup] run=${RUN_TAG} releasing pooled user=${id} at=${releasedAt}\n`);
  }
  const releaseResults = await Promise.all(
    toRelease.map((id) =>
      Promise.resolve(admin.rpc("release_test_pool_user", { p_user_id: id, p_lease_id: RUN_TAG }))
        .then((r) => (r.error ? `${id}: ${r.error.message}` : null))
        .catch((e) => `${id}: ${e instanceof Error ? e.message : String(e)}`),
    ),
  );

  const deletedAt = new Date().toISOString();
  for (const id of toDelete) {
    process.stdout.write(`[test-cleanup] run=${RUN_TAG} deleting user=${id} at=${deletedAt}\n`);
  }
  const deleteResults = await Promise.all(
    toDelete.map((id) =>
      admin.auth.admin
        .deleteUser(id)
        .then((r) => (r.error ? `${id}: ${r.error.message}` : null))
        .catch((e) => `${id}: ${e instanceof Error ? e.message : String(e)}`),
    ),
  );

  const failed = [...releaseResults, ...deleteResults].filter((r): r is string => r !== null);
  if (failed.length) {
    // process.stdout.write, not console.warn, and every failure listed, not
    // just the first — same reasoning as the "deleting user=X" line above,
    // applied to the line that matters more: this is the ONE place that
    // would show a delete genuinely failing inside a passing file's
    // teardown, which is exactly the case #156 needs visible and exactly
    // the case the default reporter drops console.* output for.
    process.stdout.write(
      `[cleanup] ${failed.length}/${ids.length} test accounts could not be released/deleted; ` +
        `a stale pooled lease self-heals after ${POOL_STALE_AFTER_SECONDS}s, and the global sweep ` +
        `will remove any unpooled straggler on a later run. Failures: ${failed.join("; ")}\n`,
    );
  }
}
