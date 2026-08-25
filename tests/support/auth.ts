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

/** Retries only a rate-limit failure; anything else is a real error, thrown as-is. */
async function withRateLimitRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRateLimited(err)) throw err;
      lastError = err;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** i));
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
  const { error: otpErr } = await client.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "magiclink",
  });
  if (otpErr) throw otpErr;
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

export async function deleteTestUsers(ids: string[]): Promise<void> {
  await Promise.all(ids.map((id) => admin.auth.admin.deleteUser(id).catch(() => {})));
}
