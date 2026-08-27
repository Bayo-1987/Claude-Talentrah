import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
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
 */

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

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

/** A real authenticated session, established the way a signed-in user has one. */
export async function sessionFor(email: string): Promise<DB> {
  const { data: link, error } = await withRateLimitRetry(() =>
    admin.auth.admin.generateLink({ type: "magiclink", email }).then((r) => {
      if (r.error) throw r.error;
      return r;
    }),
  );
  if (error || !link) throw error ?? new Error("no magic link");

  const client = createClient<Database>(URL, ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  /*
   * WRAPPED, like the two calls above it — which it was not, and that is the
   * whole of this fix.
   *
   * `withRateLimitRetry` guarded `createUser` and `generateLink`. Neither has
   * ever been the call that failed. Every rate-limit failure in this repo's CI
   * — six in one afternoon, always reported against a suite the PR had not
   * touched — came back with the same stack:
   *
   *     SupabaseAuthClient.verifyOtp   node_modules/@supabase/auth-js/...
   *     sessionFor                     tests/support/auth.ts:93
   *     createAuthedTestUser           tests/support/auth.ts:107
   *
   * The one call being limited was the only one without the backoff the
   * module was written to provide. Verifying an OTP is its own rate-limited
   * endpoint in Supabase, metered separately from creating a user or minting
   * a link, so guarding those two bought nothing here.
   */
  await withRateLimitRetry(() =>
    client.auth
      .verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" })
      .then((r) => {
        if (r.error) throw r.error;
        return r;
      }),
  );
  return client;
}

/** Convenience: an account plus its session, the common case. */
export async function createAuthedTestUser(
  prefix: string,
  meta?: Record<string, unknown>,
): Promise<TestUser & { client: DB }> {
  const user = await createTestUser(prefix, meta);
  return { ...user, client: await sessionFor(user.email) };
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
