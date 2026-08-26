import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Read auth users across ALL pages.
 *
 * `admin.auth.admin.listUsers()` with no arguments returns only the FIRST
 * PAGE — GoTrue's default is 50, ordered newest-first. Every caller in this
 * repo used it that way, and every one of them was wrong in one of two ways:
 *
 *   * CLEANUP HOOKS silently left behind whichever throwaway accounts had
 *     fallen past page one. Since older accounts sort last, the ones that
 *     survive are precisely the ones that have been accumulating longest.
 *   * FIND-OR-CREATE broke outright. scripts/seed.ts looked up the demo
 *     account, failed to find it past page one, called createUser and got
 *     `A user with this email address has already been registered`. That took
 *     main's CI down and looked like contention on the shared project. Fixed
 *     in #53 — for the seed only. The same call shape survived in four test
 *     files, including one find-or-create with the identical failure ahead of
 *     it.
 *
 * The page size here is 200 rather than the default 50 purely to cut round
 * trips; correctness comes from the loop, not the size. Termination is by
 * SHORT PAGE rather than by a total, because GoTrue does not reliably return
 * one.
 */

type AdminClient = Pick<SupabaseClient, "auth">;

export async function listAllUsers(
  client: AdminClient,
): Promise<Array<{ id: string; email: string | undefined }>> {
  const out: Array<{ id: string; email: string | undefined }> = [];
  const perPage = 200;
  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    out.push(...data.users.map((u) => ({ id: u.id, email: u.email })));
    if (data.users.length < perPage) return out;
  }
}

/** Every account whose email starts with `prefix`, across all pages. */
export async function listUsersWithPrefix(
  client: AdminClient,
  prefix: string,
): Promise<Array<{ id: string; email: string | undefined }>> {
  return (await listAllUsers(client)).filter((u) => u.email?.startsWith(prefix));
}

/** One account by exact email, across all pages, or null. */
export async function findUserByEmail(
  client: AdminClient,
  email: string,
): Promise<{ id: string; email: string | undefined } | null> {
  const perPage = 200;
  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const hit = data.users.find((u) => u.email === email);
    if (hit) return { id: hit.id, email: hit.email };
    if (data.users.length < perPage) return null;
  }
}
