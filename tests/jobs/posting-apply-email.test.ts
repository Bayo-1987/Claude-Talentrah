/**
 * PR-E2b: the one question every surface asks, "does this posting take applications by email?" (src/lib/jobs/posting-apply-email.ts). The answer is the stored address judged by
 * normaliseApplyEmail, or null; a row from a path that does not select the column has no address. Every address below is invented.
 */
import { describe, expect, it } from "vitest";
import { postingApplyEmail, takesApplicationsByEmail } from "@/lib/jobs/posting-apply-email";

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

// PR-E4 gate 2: the same helper answers for a career-site link. The cases live in tests/jobs/off-platform-guards.test.ts; this one pins that the e-mail answers above are unchanged by it.
describe("takesApplicationsByEmail is untouched by the link", () => {
  it("an e-mail address still answers true, and a link kind alone is not an e-mail", () => {
    expect(takesApplicationsByEmail({ apply_email: "careers@example.test", apply_link_kind: null } as never)).toBe(true);
    expect(takesApplicationsByEmail({ apply_link_kind: "company" } as never)).toBe(false);
  });
});
