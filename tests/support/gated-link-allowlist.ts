/**
 * The known signed-out links that lead to /login — send-477's ratchet.
 *
 * SHRINK-ONLY. A NEW gated link fails the check; removing a link without
 * deleting its row here also fails it. See e2e/signed-out-link-gate.spec.ts.
 */

export type Coverage = "ci" | "prod-only";

/** Who removes the row, by name. A row without one of these fails the integrity test. */
export const ALLOWLIST_OWNERS = ["prompt-2", "prompt-3", "scholarships-landing"] as const;
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
  {
    key: "footer:* -> /jobs",
    coverage: "ci",
    sources: [
      { file: "src/components/marketing/marketing-footer.tsx", label: "Job Matching" },
    ],
    owner: "prompt-3",
  },
  {
    key: "footer:* -> /resume-builder",
    coverage: "ci",
    sources: [
      { file: "src/components/marketing/marketing-footer.tsx", label: "Resume Builder" },
    ],
    owner: "prompt-2",
  },
  {
    key: "footer:* -> /tracker",
    coverage: "ci",
    sources: [
      { file: "src/components/marketing/marketing-footer.tsx", label: "Job Tracker" },
    ],
    owner: "prompt-3",
  },
  {
    key: "footer:* -> /refer",
    coverage: "ci",
    sources: [
      { file: "src/components/marketing/marketing-footer.tsx", label: "Refer & Earn" },
    ],
    owner: "prompt-3",
  },
  {
    key: "main:/ -> /resume-builder",
    coverage: "ci",
    sources: [
      { file: "src/components/marketing/jd-demo-input.tsx", label: "Build a resume" },
    ],
    owner: "prompt-2",
  },
  // Two sources, one key. #582 kept the homepage job-board button on /jobs deliberately.
  {
    key: "main:/ -> /jobs",
    coverage: "ci",
    sources: [
      { file: "src/components/marketing/jd-demo-input.tsx", label: "Browse jobs instead" },
      { file: "src/components/marketing/job-board-preview.tsx", label: "Browse all jobs" },
    ],
    owner: "prompt-3",
  },
  {
    key: "main:404 -> /jobs",
    coverage: "ci",
    sources: [
      { file: "src/app/not-found.tsx", label: "Browse jobs" },
    ],
    owner: "prompt-3",
  },
  {
    key: "main:/jobs/* -> /jobs",
    coverage: "ci",
    sources: [
      { file: "src/app/(app)/jobs/[id]/page.tsx", label: "Back to jobs" },
    ],
    owner: "prompt-2",
  },
  {
    key: "main:/blog/* -> /jobs",
    coverage: "ci",
    sources: [
      { file: "src/lib/blog/related-links.ts", label: "See your own Match Scores in the jobs feed" },
    ],
    owner: "prompt-3",
  },
  {
    key: "main:/blog/* -> /tailor",
    coverage: "ci",
    sources: [
      { file: "src/lib/blog/related-links.ts", label: "Tailor your resume to a specific job" },
      { file: "src/lib/blog/related-links.ts", label: "Tailor your resume with Farah" },
    ],
    owner: "prompt-2",
  },
  {
    key: "main:/blog/* -> /resume-builder",
    coverage: "ci",
    sources: [
      { file: "src/lib/blog/related-links.ts", label: "Build a resume from an ATS-safe template" },
    ],
    owner: "prompt-2",
  },
  // The database fix removed the in-body link; this is the page-chrome link from related-links.ts.
  {
    key: "main:/blog/* -> /tailor?coverLetter=1",
    coverage: "ci",
    sources: [
      { file: "src/lib/blog/related-links.ts", label: "Write your cover letter with Farah" },
    ],
    owner: "prompt-2",
  },
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
