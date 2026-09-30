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

export const GATED_LINK_ALLOWLIST: readonly GatedLinkAllowance[] = [
  {
    key: "footer:* -> /jobs",
    coverage: "ci",
    sources: [
      { file: "src/components/marketing/marketing-footer.tsx", label: "Job Matching" },
    ],
    followUp: "UNASSIGNED",
  },
  {
    key: "footer:* -> /resume-builder",
    coverage: "ci",
    sources: [
      { file: "src/components/marketing/marketing-footer.tsx", label: "Resume Builder" },
    ],
    followUp: "UNASSIGNED",
  },
  {
    key: "footer:* -> /tracker",
    coverage: "ci",
    sources: [
      { file: "src/components/marketing/marketing-footer.tsx", label: "Job Tracker" },
    ],
    followUp: "UNASSIGNED",
  },
  {
    key: "footer:* -> /refer",
    coverage: "ci",
    sources: [
      { file: "src/components/marketing/marketing-footer.tsx", label: "Refer & Earn" },
    ],
    followUp: "UNASSIGNED",
  },
  {
    key: "main:/ -> /resume-builder",
    coverage: "ci",
    sources: [
      { file: "src/components/marketing/jd-demo-input.tsx", label: "Build a resume" },
    ],
    followUp: "UNASSIGNED",
  },
  {
    key: "main:/ -> /scholarships",
    coverage: "ci",
    sources: [
      { file: "src/components/marketing/jd-demo-input.tsx", label: "Find a scholarship" },
    ],
    followUp: "signed-out /scholarships landing build: makes /scholarships public, which removes this row (delete it in that PR)",
  },
  {
    key: "main:/ -> /jobs",
    coverage: "ci",
    sources: [
      { file: "src/components/marketing/jd-demo-input.tsx", label: "Browse jobs instead" },
      { file: "src/components/marketing/job-board-preview.tsx", label: "Browse all jobs" },
    ],
    followUp: "UNASSIGNED (#582 kept the homepage job-board button on /jobs deliberately)",
  },
  {
    key: "main:404 -> /jobs",
    coverage: "ci",
    sources: [
      { file: "src/app/not-found.tsx", label: "Browse jobs" },
    ],
    followUp: "UNASSIGNED",
  },
  {
    key: "main:/jobs/* -> /jobs",
    coverage: "ci",
    sources: [
      { file: "src/app/(app)/jobs/[id]/page.tsx", label: "Back to jobs" },
    ],
    followUp: "UNASSIGNED",
  },
  {
    key: "main:/scholarships/* -> /scholarships",
    coverage: "ci",
    sources: [
      { file: "src/app/(app)/scholarships/[id]/page.tsx", label: "Back to scholarships" },
    ],
    followUp: "signed-out /scholarships landing build: makes /scholarships public, which removes this row (delete it in that PR)",
  },
  {
    key: "main:/blog/* -> /scholarships",
    coverage: "prod-only",
    sources: [
      { file: "src/lib/blog/related-links.ts", label: "Browse the scholarship catalog" },
    ],
    followUp: "signed-out /scholarships landing build: makes /scholarships public, which removes this row (delete it in that PR). prod-only: the six scholarship posts exist only in production content, not in CI's seeded database; the unit companion (tests/marketing/gated-link-ratchet.test.tsx) still enforces it in CI",
  },
  {
    key: "main:/blog/* -> /jobs",
    coverage: "ci",
    sources: [
      { file: "src/lib/blog/related-links.ts", label: "See your own Match Scores in the jobs feed" },
    ],
    followUp: "UNASSIGNED (same file as the Prompt 2 fix for the cover-letter link; confirm whether it covers this entry)",
  },
  {
    key: "main:/blog/* -> /tailor",
    coverage: "ci",
    sources: [
      { file: "src/lib/blog/related-links.ts", label: "Tailor your resume to a specific job" },
      { file: "src/lib/blog/related-links.ts", label: "Tailor your resume with Farah" },
    ],
    followUp: "UNASSIGNED (same file as the Prompt 2 fix for the cover-letter link; confirm whether it covers these entries)",
  },
  {
    key: "main:/blog/* -> /resume-builder",
    coverage: "ci",
    sources: [
      { file: "src/lib/blog/related-links.ts", label: "Build a resume from an ATS-safe template" },
    ],
    followUp: "UNASSIGNED (same file as the Prompt 2 fix for the cover-letter link; confirm whether it covers this entry)",
  },
  {
    key: "main:/blog/* -> /tailor?coverLetter=1",
    coverage: "ci",
    sources: [
      { file: "src/lib/blog/related-links.ts", label: "Write your cover letter with Farah" },
    ],
    followUp: "Prompt 2 (stated by the founder: it fixes related-links.ts). The database fix removed the in-body link; this is the page-chrome link from code",
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
