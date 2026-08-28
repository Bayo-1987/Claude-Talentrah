import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import type { Database } from "@/lib/supabase/types";

/**
 * Shared throwaway-account helper for the integration suites.
 *
 * WHY THIS EXISTS. Every suite here runs against the one real Supabase project
 * and mints real auth users, and Supabase Auth rate-limits its admin endpoints.
 * Once the referral and tracker suites landed, a full CI run created enough
 * accounts in a burst to trip it — and the failure is genuinely confusing,
 * because it does not surface as "rate limited": the account simply isn't
 * created, so a later assertion fails with something like
 * "expected [] to have a length of 1" in a completely unrelated suite whose
 * fixture user never existed. One CI run failed six tests across three files
 * that way, none of which had anything wrong with them.
 *
 * Two mitigations, both needed:
 *   1. RETRY with backoff here, so a transient limit costs seconds not a run.
 *   2. Create FEWER users — the retry only buys headroom, it does not create
 *      budget. Suites should seed state directly with the service role wherever
 *      a real session isn't the thing under test, and share one user across
 *      cases that don't need isolation.
 *
 * Neither was enough, because the call being limited was `verifyOtp` and no
 * amount of backoff fits inside a 60s hook. `sessionFor` no longer logs in at
 * all — see the note on it. `createUser` is still a real auth call, so the
 * retry below still earns its place, but the burst it has to survive is now a
 * third of what it was.
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
 * Creates a confirmed throwaway account. `prefix` should identify the suite so
 * a leaked account is traceable to the file that made it.
 */
export async function createTestUser(
  prefix: string,
  meta?: Record<string, unknown>,
): Promise<TestUser> {
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
    throw new Error(
      `minted session was not honoured as ${sub} — PostgREST is treating this token as anon. ` +
        `Check SUPABASE_JWT_SECRET matches the project at ${URL}.`,
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
 */
export async function deleteTestUsers(ids: string[]): Promise<void> {
  const results = await Promise.all(
    ids.map((id) =>
      admin.auth.admin
        .deleteUser(id)
        .then((r) => (r.error ? `${id}: ${r.error.message}` : null))
        .catch((e) => `${id}: ${e instanceof Error ? e.message : String(e)}`),
    ),
  );
  const failed = results.filter((r): r is string => r !== null);
  if (failed.length) {
    console.warn(
      `[cleanup] ${failed.length}/${ids.length} test accounts could not be deleted; ` +
        `the global sweep will remove them on a later run. First: ${failed[0]}`,
    );
  }
}
