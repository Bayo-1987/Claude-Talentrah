/**
 * What counts as a fixture organisation, in one place.
 *
 * Three consumers need to agree on this and must not drift: the per-suite
 * teardown, the global sweep that backstops it, and
 * scripts/cleanup-test-orgs.ts. A pattern added to one and not the others is
 * how residue starts accumulating again.
 *
 * Domains are preferred over names where a suite sets one: `.example` is
 * reserved by RFC 2606 and can never be a real company's domain.
 */
export const FIXTURE_DOMAIN_PATTERNS = [
  "camp-%.example", // tests/billing/ad-campaigns.test.ts, tests/support/cleanup.test.ts
  "out-%.example", // tests/billing/ad-campaigns.test.ts (the outsider org)
  "trkfix-%.example", // tests/tracker/tracker-and-farah.test.ts
] as const;

export const FIXTURE_NAME_PATTERNS = [
  "Campaign Co %", // tests/billing/ad-campaigns.test.ts
  "Outsider Co %", // tests/billing/ad-campaigns.test.ts
  "Teardown Co %", // tests/support/cleanup.test.ts
  "Wallet Test Co %", // tests/billing/ad-wallet.test.ts
  "Tracker Fixture Co %", // tests/tracker/tracker-and-farah.test.ts
  "COLPRIV-TEST %", // tests/rls/column-privileges.test.ts
  "COLPRIV-ROLE %", // tests/rls/column-privileges.test.ts
  "EMPLOYER-TEST%", // tests/employer/employer-flow.test.ts
  "AUTOAPPLY-TEST Org %", // tests/auto-apply/enforcement.test.ts
  "E2E Employer Co%", // e2e/employer.spec.ts — Playwright, not vitest, but it
  //                     leaks into the same project and its own afterEach had
  //                     the identical discarded-error bug.
] as const;

/**
 * Real organisations in the live project. NOT the mechanism that protects
 * them — the allowlist above is, since a row matching nothing is never touched
 * — but the assertion that proves the mechanism still holds.
 *
 * "Zaria Digital" is scripts/seed.ts's demo org and the golden-path e2e runs
 * against its postings. "Fatishcakes" is a real signed-up employer. Note that
 * Zaria's domain is itself a `.example`, which is why the domain patterns above
 * are prefixed rather than a bare `%.example`.
 */
export const PROTECTED_ORG_NAMES = ["Zaria Digital", "Fatishcakes"] as const;

export type FixtureOrg = { id: string; name: string; domain: string | null; created_at?: string };

/**
 * Only sweep organisations older than this.
 *
 * Credit where due: this gate comes from the concurrently-developed PR #56,
 * which got it right and this file originally did not. Up to 33 files run in
 * parallel, and CI can be running against the same project while someone runs
 * locally — there is no staging database. Without an age gate a sweep deletes
 * organisations out from under a live run, and the failures look like RLS bugs
 * rather than like a sweep.
 *
 * Two hours: far beyond the longest observed run (~10 minutes), far below the
 * gap between sessions. The repo-wide `talentrah-shared-supabase` concurrency
 * group serialises CI against itself but does nothing about CI versus a local
 * run, so the gate is doing real work.
 */
export const SWEEP_STALE_AFTER_MS = 2 * 60 * 60 * 1000;

/** Throws if the selection contains a known-real organisation. */
export function assertNoProtectedOrgs(orgs: FixtureOrg[]): void {
  const hits = orgs.filter((o) => (PROTECTED_ORG_NAMES as readonly string[]).includes(o.name));
  if (hits.length) {
    throw new Error(
      "ABORTED: fixture patterns matched protected organisations: " +
        hits.map((o) => `${o.name} (${o.domain})`).join(", "),
    );
  }
}

/**
 * Every organisation matching a fixture pattern.
 *
 * `olderThanMs` defaults to SWEEP_STALE_AFTER_MS so the common caller — the
 * global sweep — cannot forget it. Pass 0 for the one-time purge script, where
 * the operator is deliberately clearing everything and no run is in flight.
 */
export async function selectFixtureOrgs(
  db: {
    from: (t: string) => {
      select: (c: string) => {
        like: (col: string, p: string) => Promise<{ data: FixtureOrg[] | null; error: { message: string } | null }>;
      };
    };
  },
  olderThanMs: number = SWEEP_STALE_AFTER_MS,
): Promise<FixtureOrg[]> {
  const found = new Map<string, FixtureOrg>();

  const collect = async (column: "domain" | "name", pattern: string) => {
    const { data, error } = await db
      .from("organizations")
      .select("id, name, domain, created_at")
      .like(column, pattern);
    if (error) throw new Error(`selecting ${column} like ${pattern}: ${error.message}`);
    for (const o of data ?? []) found.set(o.id, o);
  };

  for (const p of FIXTURE_DOMAIN_PATTERNS) await collect("domain", p);
  for (const p of FIXTURE_NAME_PATTERNS) await collect("name", p);

  const orgs = [...found.values()];

  // Asserted BEFORE the age filter, deliberately: a protected organisation
  // matching a fixture pattern is a broken pattern whether or not it happens
  // to be young enough to survive this particular run.
  assertNoProtectedOrgs(orgs);

  if (olderThanMs <= 0) return orgs;
  const cutoff = Date.now() - olderThanMs;
  return orgs.filter((o) => !o.created_at || new Date(o.created_at).getTime() < cutoff);
}
