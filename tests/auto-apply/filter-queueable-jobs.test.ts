/**
 * `filterQueueableJobs` (src/lib/auto-apply/queue.ts) is `scanAndQueue`'s copy
 * of the public-listing gate — the same shape as `filterListablePostings`
 * (src/lib/digest/send.ts, PR #285), which itself matches 0109's reasoning
 * for `promoted_jobs`.
 *
 * ── THE BUG THIS CLOSES ────────────────────────────────────────────────────
 *
 * `scanAndQueue` reads `match_scores` and `job_postings` through the
 * service-role client, which bypasses RLS entirely. Every RLS-gated surface
 * (the feed, `search_job_postings`, the sitemap, the SEO landing pages) gets
 * `organizations.verified` enforced for free by the `job postings are
 * publicly readable` policy (0027, 0107) — `scanAndQueue`'s own reads did
 * not, because nothing there ever evaluated that policy. A posting scored
 * Excellent while its organisation was verified keeps that `match_scores`
 * row after the org un-verifies (`saveCompanyProfileAction` re-runs
 * verification in both directions on a domain change) — so it could still be
 * queued, surfaced in the Auto-Apply review screen, and (since nothing
 * downstream re-checks verification either — see
 * `docs/auto-apply.md` and `auto_apply_claim_submission`, 0034) confirmed
 * into a real `applications` row on the seeker's behalf.
 *
 * This is a pure, DB-free unit test of the filter itself. The real-database
 * proof that `scanAndQueue` actually calls it correctly lives in
 * `tests/auto-apply/scan-verification-gate.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { filterQueueableJobs, type QueueableJobCandidate } from "@/lib/auto-apply/queue";

describe("SABOTAGE-PROOF TARGET: filterQueueableJobs", () => {
  it("keeps an internal job whose organisation is verified", () => {
    const jobs: QueueableJobCandidate[] = [{ id: "job-1", sourceType: "internal", organizationId: "org-verified" }];
    const result = filterQueueableJobs(jobs, new Set(["org-verified"]));
    expect(result.map((j) => j.id)).toEqual(["job-1"]);
  });

  it("drops an internal job whose organisation is NOT in the verified set", () => {
    const jobs: QueueableJobCandidate[] = [
      { id: "job-1", sourceType: "internal", organizationId: "org-unverified" },
    ];
    const result = filterQueueableJobs(jobs, new Set(["some-other-org"]));
    expect(result).toEqual([]);
  });

  it("drops a job whose organisation verified in the past but is no longer in the verified set (the actual bug scenario)", () => {
    // organizationId is real and present, but verifiedOrganizationIds — built
    // fresh from `organizations` on every scan — no longer contains it. This
    // is exactly saveCompanyProfileAction flipping `verified` back to false
    // after a match_scores row already existed for this org's posting.
    const jobs: QueueableJobCandidate[] = [
      { id: "job-stale", sourceType: "internal", organizationId: "org-that-un-verified" },
    ];
    const result = filterQueueableJobs(jobs, new Set());
    expect(result).toEqual([]);
  });

  it("keeps an external job unconditionally — nothing to verify", () => {
    const jobs: QueueableJobCandidate[] = [{ id: "job-ext", sourceType: "external", organizationId: null }];
    const result = filterQueueableJobs(jobs, new Set());
    expect(result.map((j) => j.id)).toEqual(["job-ext"]);
  });

  it("filters a mixed batch correctly, preserving order", () => {
    const jobs: QueueableJobCandidate[] = [
      { id: "verified-1", sourceType: "internal", organizationId: "org-a" },
      { id: "external-1", sourceType: "external", organizationId: null },
      { id: "unverified-1", sourceType: "internal", organizationId: "org-b" },
      { id: "verified-2", sourceType: "internal", organizationId: "org-a" },
    ];
    const result = filterQueueableJobs(jobs, new Set(["org-a"]));
    expect(result.map((j) => j.id)).toEqual(["verified-1", "external-1", "verified-2"]);
  });
});
