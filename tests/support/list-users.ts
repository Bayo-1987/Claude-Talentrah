import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A tag unique to THIS test process, for scoping prefix sweeps.
 *
 * ── WHY A CLEANUP HOOK NEEDED ONE ────────────────────────────────────────
 *
 * Four suites tore down by listing every account whose email starts with a
 * fixed prefix — `trk-`, `reftest-`, `rate-limit-`, `credit-race-` — and
 * deleting all of them. Three of them called the result `mine`. It was not
 * theirs: the prefix is shared by every run of that suite, on every branch,
 * forever, and the CI project is shared with no staging database.
 *
 * So two overlapping runs delete each other's LIVE fixtures. Deleting the auth
 * user cascades to `profiles`, and the next insert that references it fails —
 * which is exactly how tracker-and-farah.test.ts produced 13 failures behind
 * one `farah_messages_user_id_fkey` violation, intermittently, on four
 * separate runs, always clearing on a retry that happened not to overlap.
 *
 * Scoping the prefix to the process keeps what the sweep is FOR — catching
 * accounts this run created and lost track of, which is why it exists rather
 * than deleting a list of ids — while making it incapable of reaching another
 * run's. Per-process rather than per-file is deliberate: the hazard is two
 * concurrent RUNS, and files inside one run already use distinct prefixes.
 */
export const RUN_TAG = randomUUID().slice(0, 8);

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
