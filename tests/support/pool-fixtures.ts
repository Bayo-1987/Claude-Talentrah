/**
 * Puts a hand-made auth user into `test_user_pool` for a test that has to touch the table directly (#593).
 *
 * Only the service role can write `test_user_pool`. This is the one place a test does it.
 *
 * THE ROW IS INSERTED WITH A LEASE. `claim_test_pool_user` hands out any row with `leased_by is null`, so a leaseless
 * row is claimable by whichever other test file claims next — and the file that made it then deletes the auth user, and
 * the claimant's `updateUserById` fails (404 `user_not_found`, or a 5xx while the delete is in flight). With a lease the
 * claim skips the row for `POOL_STALE_AFTER_SECONDS` (600 s in auth.ts), far longer than any file that uses this helper
 * runs. `test-user-pool-fixture-guard.test.ts` fails any insert into the table that does not name `leased_by`.
 */
import { admin } from "./auth";

export const POOL_FIXTURE_LEASE = "pool-fixture";

export async function insertPoolFixtureRow(userId: string, prefix: string) {
  return admin
    .from("test_user_pool")
    .insert({ user_id: userId, prefix, leased_by: POOL_FIXTURE_LEASE, leased_at: new Date().toISOString() });
}
