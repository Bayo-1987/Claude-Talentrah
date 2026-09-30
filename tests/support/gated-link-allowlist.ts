/**
 * The known signed-out links that lead to /login — send-477's ratchet.
 *
 * SHRINK-ONLY. A NEW gated link fails the check; removing a link without
 * deleting its row here also fails it. See e2e/signed-out-link-gate.spec.ts.
 */

export type Coverage = "ci" | "prod-only";

export interface GatedLinkAllowance {
  /** `region:page-group -> target`, built by offenderKey() in scripts/link-check.ts. */
  key: string;
  /**
   * "ci": reachable in CI's seeded database, so the crawl must see it there — a
   * row the crawl no longer sees is STALE and fails. "prod-only": only exists
   * in production content; enforced only by `npm run check-signed-out-links`.
   */
  coverage: Coverage;
  /** Where the link comes from, as file + the label it renders (not a line number — those rot). */
  sources: Array<{ file: string; label: string }>;
  /** What removes it. Say "UNASSIGNED" rather than guess. */
  followUp: string;
}

export const GATED_LINK_ALLOWLIST: readonly GatedLinkAllowance[] = [];

export type EnforcementScope = "ci" | "all";

/** Whether a row that the crawl did NOT observe is an error in this scope. */
export function enforcedForScope(row: GatedLinkAllowance, scope: EnforcementScope): boolean {
  return scope === "all" || row.coverage === "ci";
}
