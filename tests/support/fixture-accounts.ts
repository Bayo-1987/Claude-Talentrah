/**
 * What counts as a throwaway test account, and what must never be swept.
 *
 * Ported from the concurrently-developed PR #56, which had this and PR #55 did
 * not. Kept beside ./fixture-orgs.ts rather than inside it because the two
 * answer different questions — which organisations are fixtures, and which
 * *accounts* are — and a sweep that conflates them is how a protected
 * principal ends up in a delete set.
 *
 * ── Why accounts need sweeping at all ─────────────────────────────────────
 *
 * `deleteTestUsers` in each suite is the mechanism and it works. PR #56
 * measured the obvious suspect and ruled it out: replaying the exact
 * `Promise.all` burst against 48 leaked accounts deleted all 48 with zero
 * failures, so auth rate limiting is NOT why accounts leak.
 *
 * They leak when the process is killed before `afterAll` runs at all — a
 * cancelled CI run, a Ctrl-C, a worker that times out. No in-process hook can
 * fix that, because by definition the process is gone. Observed live while
 * consolidating these branches: two CI runs were cancelled by the repo-wide
 * `talentrah-shared-supabase` concurrency group, and the killed run's fixtures
 * were still in the project afterwards.
 *
 * ── The two filters, in this order ────────────────────────────────────────
 *
 * PROTECTED FIRST, AGE SECOND — matching how ./fixture-orgs.ts orders the same
 * two checks, and for the same reason. A protected principal appearing in a
 * fixture selection means the FILTER is wrong, which is true whether or not
 * that particular row happens to be young enough to survive this run. Ordering
 * it after the age gate would make the guard's firing depend on timing, which
 * is the one thing a safety assertion must not do.
 *
 * As written the protected check is unreachable: nothing can end in both
 * `@talentrah.test` and `@talentrah.dev`. It is kept deliberately — PR #56
 * made the same call — because the moment someone widens TEST_ACCOUNT_DOMAIN
 * to cover, say, the referral suites' `@gmail.com` fixtures, it stops being
 * dead code and becomes the only thing standing between the sweep and the
 * seeded demo accounts.
 */

/** `createTestUser` mints every account as `${prefix}-${uuid}@talentrah.test`. */
export const TEST_ACCOUNT_DOMAIN = "@talentrah.test";

/** The seeded demo accounts. Long-lived on purpose; `scripts/seed.ts` owns them. */
export const PROTECTED_ACCOUNT_DOMAINS = ["@talentrah.dev"] as const;

export type TestAccount = { id: string; email: string; created_at: string };

/**
 * Throws if a protected account reached the sweep set. Aborts rather than
 * filters, for the reason in the header: this firing means the filter is
 * broken, so nothing else in the selection can be trusted either.
 */
export function assertNoProtectedAccounts(accounts: TestAccount[]): void {
  const hits = accounts.filter((a) =>
    PROTECTED_ACCOUNT_DOMAINS.some((d) => a.email.toLowerCase().endsWith(d)),
  );
  if (hits.length) {
    throw new Error(
      "ABORTED: test-account filter matched protected accounts: " +
        hits.map((a) => a.email).join(", "),
    );
  }
}
