/**
 * getJobShareVisibility — the single place that decides whether a job's link
 * is something an employer can hand out. This mirrors the actual RLS policy
 * on job_postings (migration 0056): verified org AND not removed. Closed is
 * deliberately NOT excluded — /jobs/[id] still renders a closed posting, it
 * just says so, so a closed job's link is not dead.
 */
import { describe, expect, it } from "vitest";
import { getJobShareVisibility } from "@/lib/employer/job-visibility";

describe("getJobShareVisibility", () => {
  it("is public for an open job at a verified org", () => {
    expect(getJobShareVisibility({ status: "open", organizationVerified: true })).toBe("public");
  });

  it("is public for a closed job at a verified org — the page still renders, it just says closed", () => {
    expect(getJobShareVisibility({ status: "closed", organizationVerified: true })).toBe("public");
  });

  it("is unreachable for an open job at an unverified org — sabotage-proof case", () => {
    expect(getJobShareVisibility({ status: "open", organizationVerified: false })).toBe(
      "unreachable",
    );
  });

  it("is unreachable for a closed job at an unverified org", () => {
    expect(getJobShareVisibility({ status: "closed", organizationVerified: false })).toBe(
      "unreachable",
    );
  });

  it("is unreachable once removed, even at a verified org", () => {
    // 0056's policy excludes status <> 'removed' unconditionally — verified
    // org membership never overrides it for the public-read clause.
    expect(getJobShareVisibility({ status: "removed", organizationVerified: true })).toBe(
      "unreachable",
    );
  });
});
