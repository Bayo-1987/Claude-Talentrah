import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/types";

/**
 * A service-role client. Typed loosely on purpose: the test suites and
 * scripts/cleanup-test-orgs.ts each construct their own, and this module must
 * not decide which — importing one would tie the FK order below to a
 * particular env-loading order.
 */
export type OrgDeletingClient = SupabaseClient<Database>;


/**
 * Teardown for organisation fixtures.
 *
 * ── The bug this exists for ───────────────────────────────────────────────
 *
 * Seven suites created organisations and every one of them already had a
 * teardown that looked correct:
 *
 *     afterAll(async () => {
 *       if (createdOrgs.length)
 *         await admin.from("organizations").delete().in("id", createdOrgs);
 *     });
 *
 * It has never once worked. `job_postings.organization_id` is **NO ACTION**,
 * not CASCADE, so the delete is refused, and supabase-js does not throw — it
 * resolves with `{ data: null, error }`, and the `error` was discarded at all
 * seven call sites. Reproduced against the live project before writing this:
 *
 *     attempting delete of: Campaign Co 8bc26a91
 *     error: {
 *       code: '23503',
 *       details: 'Key (id)=(b32bf622-…) is still referenced from table "job_postings".',
 *       message: 'update or delete on table "organizations" violates foreign
 *                 key constraint "job_postings_organization_id_fkey"'
 *     }
 *     rows deleted: null
 *     still present after delete? true
 *
 * The result was a 100% leak rate — not an occasional one — into the shared
 * live project (there is no staging database; CLAUDE.md). By the time it was
 * found: 314 organizations, of which 312 were fixtures, plus 318 ad_campaigns,
 * 192 ad_wallets and 385 ledger rows. 117 of those campaigns were `active`, so
 * the daily charge cron added in PR #51 would have rediscovered and "charged"
 * them every morning forever, burying real signal in every future run summary.
 *
 * TWO SEPARATE MISTAKES, and the second is the one worth remembering. Getting
 * the FK order wrong is ordinary. Discarding the error is what let it survive
 * for months across seven files — a teardown that fails loudly gets fixed the
 * same afternoon. Everything here checks its error and throws.
 *
 * ── The delete order ──────────────────────────────────────────────────────
 *
 * Read from pg_constraint rather than assumed:
 *
 *   organizations ← CASCADE:   ad_campaigns, ad_wallets, ad_wallet_ledger,
 *                              organization_members
 *   organizations ← NO ACTION: job_postings, payment_transactions
 *   job_postings  ← CASCADE:   ad_campaigns, auto_apply_queue, match_scores
 *   job_postings  ← NO ACTION: applications, job_tailoring_requests,
 *                              resumes.tailored_for_job_id
 *
 * So only the NO ACTION edges need doing by hand, deepest first. The CASCADE
 * ones are left to Postgres deliberately: re-deleting them here would be dead
 * code that silently starts mattering if a constraint is ever changed.
 *
 * `resumes` is NULLed rather than deleted — a resume belongs to a user, not to
 * the organisation whose posting it was tailored for, so deleting it would
 * destroy someone else's fixture.
 *
 * ── A teardown cannot clean up after a failure that stops the teardown ────
 *
 * This is the mechanism, and it is not sufficient on its own. Measured: run
 * tests/billing/ad-campaigns.test.ts alone and the organisation count is
 * unchanged (23 before, 23 after). Run the full suite into Supabase's auth
 * rate limit — the condition CLAUDE.md documents as "not a real failure" — and
 * 21 organisations from that same file survive, because the hook that would
 * have removed them never finished.
 *
 * tests/support/global-teardown.ts is the backstop for exactly those runs. It
 * sweeps once at the end of the whole run, by the shared allowlist in
 * ./fixture-orgs.ts. Treat a straggler on a CLEAN run as a bug in that suite,
 * not as something the sweep exists to absorb.
 *
 * NOT FIXED HERE, deliberately: making `job_postings.organization_id` CASCADE
 * would be the tidier schema, but it is a product decision (should deleting an
 * employer destroy the postings applicants have applied to?) and it would not
 * even work — `applications.job_posting_id` is NO ACTION, so a real org with
 * applications would still refuse. Recorded in docs/employer-billing-plan.md.
 */

async function del(
  db: OrgDeletingClient,
  table: string,
  column: string,
  values: string[],
): Promise<void> {
  if (!values.length) return;
  // Chunked: `in` builds a URL, and a few hundred UUIDs overruns PostgREST's
  // request line. 100 keeps it well clear.
  for (let i = 0; i < values.length; i += 100) {
    const chunk = values.slice(i, i + 100);
    const { error } = await db.from(table as never).delete().in(column, chunk);
    if (error) {
      throw new Error(
        `test teardown failed deleting ${table}.${column} (${chunk.length} rows): ` +
          `${error.message}${error.code ? ` [${error.code}]` : ""}`,
      );
    }
  }
}

/**
 * Deletes job postings and everything blocking them.
 *
 * Split out of deleteOrgsCascade so a suite that owns a posting WITHOUT an
 * organisation can reuse it — an external fixture posting has
 * `organization_id = null`, so no org delete reaches it and the global sweep,
 * which works from the organisation allowlist, cannot see it either.
 *
 * The FK facts live here and only here, which is the point: the first attempt
 * to hand-roll this elsewhere used `job_tailoring_requests.job_posting_id`
 * (the column is `source_job_posting_id`) and would have deleted resumes that
 * merely reference the posting instead of unlinking them.
 *
 *   job_postings ← CASCADE:   ad_campaigns, auto_apply_queue, match_scores
 *   job_postings ← NO ACTION: applications.job_posting_id,
 *                             job_tailoring_requests.source_job_posting_id,
 *                             resumes.tailored_for_job_id
 *
 * `resumes` is NULLed rather than deleted: a resume belongs to a user, not to
 * the posting it was tailored for.
 */
export async function deletePostingsCascade(
  db: OrgDeletingClient,
  postingIds: string[],
): Promise<void> {
  const ids = [...new Set(postingIds.filter(Boolean))];
  if (!ids.length) return;

  await del(db, "applications", "job_posting_id", ids);
  await del(db, "job_tailoring_requests", "source_job_posting_id", ids);
  for (let i = 0; i < ids.length; i += 100) {
    const { error } = await db
      .from("resumes")
      .update({ tailored_for_job_id: null })
      .in("tailored_for_job_id", ids.slice(i, i + 100));
    if (error) throw new Error(`test teardown failed unlinking resumes: ${error.message}`);
  }
  await del(db, "job_postings", "id", ids);
}

/**
 * Deletes organisations and everything blocking them. Throws on any failure,
 * so a broken teardown fails the suite instead of quietly filling production.
 */
export async function deleteOrgsCascade(
  db: OrgDeletingClient,
  orgIds: string[],
): Promise<void> {
  const ids = [...new Set(orgIds.filter(Boolean))];
  if (!ids.length) return;

  const postingIds: string[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await db
      .from("job_postings")
      .select("id")
      .in("organization_id", ids.slice(i, i + 100));
    if (error) throw new Error(`test teardown failed listing job_postings: ${error.message}`);
    postingIds.push(...(data ?? []).map((r) => r.id));
  }

  await deletePostingsCascade(db, postingIds);

  // Depth 1 — the other NO ACTION child of organizations.
  await del(db, "payment_transactions", "organization_id", ids);

  // The org itself; Postgres cascades campaigns, wallets, ledger and members.
  await del(db, "organizations", "id", ids);
}
