/**
 * PR-E2b: the one question every surface asks, "does this posting take applications by email?" (src/lib/jobs/posting-apply-email.ts). The answer is the stored address judged by
 * normaliseApplyEmail, or null; a row from a path that does not select the column has no address. Every address below is invented.
 */
import { describe, expect, it } from "vitest";
import { postingApplyEmail, takesApplicationsByEmail, takesApplicationsInApp } from "@/lib/jobs/posting-apply-email";

describe("postingApplyEmail", () => {
  it("returns the normalised address", () => {
    expect(postingApplyEmail({ apply_email: " Careers@Example.TEST " })).toBe("careers@example.test");
  });
  it.each([undefined, null, "", "   ", "not-an-address", "a@b", "a@b.co, c@d.co", "a@b.co?cc=x", "<a@b.co>", "é@b.co"])("returns null for %j (refused, never repaired)", (value) => {
    expect(postingApplyEmail({ apply_email: value as string | null | undefined })).toBeNull();
  });
  it("returns null for a missing row or a row without the column", () => {
    expect(postingApplyEmail(null)).toBeNull();
    expect(postingApplyEmail(undefined)).toBeNull();
    expect(postingApplyEmail({})).toBeNull();
  });
});

describe("takesApplicationsByEmail", () => {
  it("is true only for a valid stored address", () => {
    expect(takesApplicationsByEmail({ apply_email: "careers@example.test" })).toBe(true);
    expect(takesApplicationsByEmail({ apply_email: "nonsense" })).toBe(false);
    expect(takesApplicationsByEmail({ apply_email: null })).toBe(false);
    expect(takesApplicationsByEmail({})).toBe(false);
  });
});

describe("takesApplicationsInApp", () => {
  it.each([
    ["an ordinary internal posting", { source_type: "internal" }, true],
    ["an internal posting with an address", { source_type: "internal", apply_email: "careers@example.test" }, false],
    ["an internal posting with an unusable stored value", { source_type: "internal", apply_email: "a, b" }, true],
    ["an external posting", { source_type: "external" }, false],
    ["an imported posting", { source_type: "internal", import_feed_id: "11111111-1111-4111-8111-111111111111" }, false],
  ])("%s", (_name, job, expected) => {
    expect(takesApplicationsInApp(job)).toBe(expected);
  });
});
