/**
 * The dependency-audit exceptions: the ONLY place a known `npm audit` finding is allowed to stay red-free.
 *
 * Read by scripts/check-dependency-audit.ts for the FULL-tree run only. The production run (`--omit=dev`, `--strict`) never reads this
 * list: a high finding in anything that ships fails regardless.
 *
 * RULES (issue #687, owner's decision 2026-10-03):
 *  - an exception is an ADVISORY ID, never a package name, so a new advisory against the same package still fails;
 *  - it has an `expires` date (YYYY-MM-DD, UTC, valid through the end of that day). After it the gate fails again, with a message
 *    naming the issue, until someone removes or renews the entry on purpose;
 *  - no exception lands without an issue that says why.
 *
 * HOW TO REMOVE THIS ONE: delete the entry below once `braces` ships a version that GHSA-vfj7-8cjw-p6xm lists as patched (check
 * https://github.com/advisories/GHSA-vfj7-8cjw-p6xm and `npm view braces version`), run `npm update braces` (or bump
 * eslint-config-next), and confirm `npm audit --audit-level=high` is clean. To RENEW instead, change `expires` in a PR that says
 * why, and link it from #687. tests/scripts/check-dependency-audit.test.ts pins the id, the date and the issue number, so changing
 * any of them is a deliberate edit to that test too.
 */
export interface AuditException {
  /** GitHub advisory id, e.g. GHSA-xxxx-xxxx-xxxx. Matched against the advisory URL npm audit reports. */
  advisory: string;
  /** Last day the exception applies, YYYY-MM-DD, UTC. */
  expires: string;
  /** The issue that records why. */
  issue: number;
  reason: string;
}

export const AUDIT_EXCEPTIONS: readonly AuditException[] = [
  {
    advisory: "GHSA-vfj7-8cjw-p6xm",
    expires: "2026-11-03",
    issue: 687,
    reason:
      "braces <= 3.0.3, stack-exhaustion DoS on deeply nested patterns, reached only through the lint-time chain " +
      "braces <- micromatch <- fast-glob <- @next/eslint-plugin-next <- eslint-config-next. No patched version exists (braces latest is 3.0.3).",
  },
];
