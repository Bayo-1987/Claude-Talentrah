import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

/**
 * Sweep stale test data before a run, once per vitest invocation.
 *
 * WHY A SWEEP AND NOT BETTER afterAll HOOKS. The suites already clean up after
 * themselves and the hooks work — measured, not assumed: replaying the exact
 * `Promise.all` burst that `deleteTestUsers` performs, against 48 leaked
 * accounts, deleted all 48 with zero failures. Auth rate limiting was the
 * obvious suspect and it is not the cause.
 *
 * The cause is that `afterAll` DOES NOT RUN when the process is killed — a
 * cancelled CI run, a Ctrl-C, a worker that times out. No in-process hook can
 * fix that, because by definition the process is gone. Only something that
 * runs LATER can, which is what this is.
 *
 * WHY NOT A SCHEDULED CRON. It was the other obvious option and it is worse
 * here on three counts: it would be a new scheduled job writing to production
 * (the standing rule is that none may do so ungated, so it needs a secret and
 * a route); it can silently stop firing, which is exactly the 0043 renewal
 * lesson this project already learned once; and it runs on a clock unrelated
 * to when the mess is made. A sweep at suite startup runs precisely when it
 * matters — immediately before the thing that creates more.
 *
 * WHY NOT A SUPABASE BRANCH. That is the right long-term answer and it is not
 * available: branching is a paid-plan feature and this project is on the free
 * tier (it pauses when idle — CLAUDE.md). Worth revisiting if the plan changes,
 * because isolating these suites from production beats cleaning up after them.
 *
 * WHAT IT WILL AND WILL NOT TOUCH.
 *  - Only `@talentrah.test`. `createTestUser` mints every account as
 *    `${prefix}-${uuid}@talentrah.test`, and no real user can hold that domain.
 *  - Only accounts older than STALE_AFTER_MS. Up to 21 files run in parallel,
 *    and CI can be running while someone runs locally against the same
 *    project; a young account may belong to a live run. Two hours is far
 *    beyond the longest observed run (~10 minutes) and far below the gap
 *    between sessions.
 *  - Never `@talentrah.dev`. Those are the three seeded demo accounts, which
 *    are long-lived on purpose. Note that this check is UNREACHABLE as written
 *    — nothing can end in both domains, so the `.test` filter above has
 *    already excluded them. It is kept deliberately, as a guard for whoever
 *    later widens that filter to cover the referral suites' `@gmail.com`
 *    fixtures; at that point it stops being dead code and starts being the
 *    only thing standing between a sweep and the demo account.
 *
 * Failures here are logged, never thrown. A sweep that cannot run is a reason
 * to look, not a reason to fail every test in the suite.
 */

/*
 * Two hours: longer than any run, shorter than any gap between them.
 *
 * The age gate is the whole safety argument, so it is worth stating what it
 * protects against. Up to 21 files run in parallel and CI can be running while
 * someone runs locally against the same project — a sweep with no age gate
 * would delete accounts out from under a live suite and produce failures that
 * look like RLS bugs. Longest observed run is ~10 minutes.
 */
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;
const TEST_DOMAIN = "@talentrah.test";
const PROTECTED_DOMAIN = "@talentrah.dev";

export default async function globalSetup() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn("[sweep] no Supabase credentials — skipping stale-data sweep");
    return;
  }

  const admin = createClient(url, key, { auth: { persistSession: false } });
  const cutoff = Date.now() - STALE_AFTER_MS;

  try {
    const stale: string[] = [];
    // Paginated on purpose. `listUsers()` with no arguments returns only the
    // first page, which is the bug that broke the seed — a sweep reading one
    // page would leave exactly the accounts that pushed the project past the
    // page boundary, i.e. the ones that matter.
    const perPage = 200;
    for (let page = 1; ; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) throw error;
      for (const u of data.users) {
        const email = u.email ?? "";
        if (!email.endsWith(TEST_DOMAIN)) continue;
        if (email.endsWith(PROTECTED_DOMAIN)) continue;
        if (new Date(u.created_at).getTime() > cutoff) continue;
        stale.push(u.id);
      }
      if (data.users.length < perPage) break;
    }

    if (stale.length === 0) return;

    const results = await Promise.all(
      stale.map((id) => admin.auth.admin.deleteUser(id).then((r) => r.error?.message ?? null)),
    );
    const failed = results.filter(Boolean);
    console.log(
      `[sweep] removed ${stale.length - failed.length}/${stale.length} stale ${TEST_DOMAIN} accounts` +
        (failed.length ? ` — ${failed.length} failed: ${failed[0]}` : ""),
    );

    /*
     * Stale test organisations.
     *
     * CHILDREN FIRST, AND THIS IS THE WHOLE POINT. Of the six FKs pointing at
     * `organizations`, four CASCADE (ad_campaigns, ad_wallets,
     * ad_wallet_ledger, organization_members) and two DO NOT:
     * `job_postings_organization_id_fkey` and
     * `payment_transactions_organization_id_fkey` are both NO ACTION.
     *
     * That asymmetry is why test organisations accumulate. Every suite that
     * creates an org also creates a posting for it, then deletes the org in
     * afterAll WITHOUT CHECKING THE ERROR — so the delete fails 23503 and the
     * row silently survives. Measured mid-session: 20 `Campaign Co %` orgs
     * present, 22 of 23 orgs with at least one posting. This was diagnosed as
     * "afterAll did not run" and that was wrong; afterAll ran and its delete
     * was rejected.
     *
     * NO ACTION is the right rule for production — deleting an organisation
     * should not silently vaporise live job postings — so the fix belongs
     * here and in the suites, not in the schema.
     */
    const { data: staleOrgs, error: findErr } = await admin
      .from("organizations")
      .select("id")
      .lt("created_at", new Date(cutoff).toISOString())
      .like("domain", "%.example");
    if (findErr) throw findErr;

    const orgIds = (staleOrgs ?? []).map((o) => o.id);
    if (orgIds.length) {
      const { error: jobErr } = await admin
        .from("job_postings")
        .delete()
        .in("organization_id", orgIds);
      if (jobErr) throw jobErr;

      const { error: payErr } = await admin
        .from("payment_transactions")
        .delete()
        .in("organization_id", orgIds);
      if (payErr) throw payErr;

      const { data: orgs, error: orgErr } = await admin
        .from("organizations")
        .delete()
        .in("id", orgIds)
        .select("id");
      // Checked, not fired and forgotten — an unchecked delete here would
      // reproduce exactly the bug this sweep exists to clean up after.
      if (orgErr) throw orgErr;
      console.log(
        `[sweep] removed ${orgs?.length ?? 0}/${orgIds.length} stale test organizations`,
      );
    }
  } catch (err) {
    console.warn("[sweep] stale-data sweep failed (continuing):", err);
  }
}
