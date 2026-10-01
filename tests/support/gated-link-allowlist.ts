/**
 * The known signed-out links that lead to /login — send-477's ratchet.
 *
 * SHRINK-ONLY. A NEW gated link fails the check; removing a link without
 * deleting its row here also fails it. See e2e/signed-out-link-gate.spec.ts.
 */

export type Coverage = "ci" | "prod-only";

/** Who removes the row, by name. A row without one of these fails the integrity test. */
export const ALLOWLIST_OWNERS = ["prompt-2"] as const;
export type AllowlistOwner = (typeof ALLOWLIST_OWNERS)[number];

export function isValidOwner(owner: unknown): owner is AllowlistOwner {
  return typeof owner === "string" && (ALLOWLIST_OWNERS as readonly string[]).includes(owner);
}

export interface GatedLinkAllowance {
  /** `region:page-group -> target`, built by offenderKey() in scripts/link-check.ts. */
  key: string;
  /**
   * "ci": reachable in CI's seeded database, so the crawl must see it there — a
   * row the crawl no longer sees is STALE and fails. "prod-only": only exists
   * in production content; enforced only by `npm run check-signed-out-links`
   * (and, for code-defined links, by the unit companion).
   */
  coverage: Coverage;
  /** Where the link comes from, as file + the label it renders (not a line number — those rot). */
  sources: Array<{ file: string; label: string }>;
  /** The piece of work that removes this row (and deletes it here). */
  owner: AllowlistOwner;
}

export const GATED_LINK_ALLOWLIST: readonly GatedLinkAllowance[] = [
  /*
   * EMPTY since send-491. The last five rows (the footer's and the hero demo's /resume-builder, and the blog's
   * /tailor, /resume-builder and /tailor?coverLetter=1) were re-pointed at public pages or the signup redirect;
   * the production crawl (LINK_GATE_SCOPE=all) found 0 gated links afterwards. Adding a row now needs a deliberate
   * edit to the "allowlist is EMPTY" test in tests/marketing/gated-link-ratchet.test.tsx as well, on purpose.
   */
];

export type EnforcementScope = "ci" | "all";

/** Whether a row that the crawl did NOT observe is an error in this scope. */
export function enforcedForScope(row: GatedLinkAllowance, scope: EnforcementScope): boolean {
  return scope === "all" || row.coverage === "ci";
}

/**
 * The ratchet, as a pure comparison. `fresh`: observed gated links no row accounts for
 * (a NEW offender). `stale`: rows whose link the crawl no longer sees, among those
 * enforced in this scope (a row must be deleted when its link is fixed, so the list
 * can only shrink).
 */
export function ratchetDiff(
  observedKeys: Iterable<string>,
  scope: EnforcementScope,
  rows: readonly GatedLinkAllowance[] = GATED_LINK_ALLOWLIST,
): { fresh: string[]; stale: string[] } {
  const observed = new Set(observedKeys);
  const allowed = new Set(rows.map((r) => r.key));
  return {
    fresh: [...observed].filter((k) => !allowed.has(k)).sort(),
    stale: rows
      .filter((r) => enforcedForScope(r, scope) && !observed.has(r.key))
      .map((r) => r.key)
      .sort(),
  };
}
