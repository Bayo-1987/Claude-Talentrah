/**
 * Puts a hand-made auth user into `test_user_pool` for a test that has to touch the table directly (#593).
 *
 * Only the service role can write `test_user_pool`. This is the one place a test does it.
 */
import { admin } from "./auth";

export async function insertPoolFixtureRow(userId: string, prefix: string) {
  return admin.from("test_user_pool").insert({ user_id: userId, prefix });
}
