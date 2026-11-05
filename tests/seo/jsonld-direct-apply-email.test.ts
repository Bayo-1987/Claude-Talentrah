/**
 * PR-E2b: structured data must not claim a direct application flow for a posting whose applications arrive by email, and must never hold the address (tests/jobs/apply-email-leaks.test.ts).
 */
import { describe, expect, it } from "vitest";
import { buildJobPostingJsonLd } from "@/lib/seo/job-posting-jsonld";

const ADDRESS = "careers@example.test";
const job = (over: Record<string, unknown>) =>
  ({
    id: "job-1", organization_id: "org-1", title: "Support Lead", company_name: "Acme", description: "<p>Do support work for customers across Nigeria.</p>", location: "Lagos, Nigeria", work_type: "onsite", employment_type: "full_time", status: "open",
    source_type: "internal", external_url: null, apply_email: null, posted_at: new Date().toISOString(), expires_at: null, import_feed_id: null, organizations: { name: "Acme", website: null, logo_url: null }, ...over,
  }) as never;

describe("directApply", () => {
  it("is true for an ordinary internal posting (unchanged)", () => {
    expect(buildJobPostingJsonLd(job({}))?.directApply).toBe(true);
  });
  it("is false for an internal posting that takes applications by email, and the address is not in the data", () => {
    const ld = buildJobPostingJsonLd(job({ apply_email: ADDRESS }));
    expect(ld, "the fixture must produce structured data").not.toBeNull();
    expect(ld?.directApply).toBe(false);
    const text = JSON.stringify(ld);
    expect(text).not.toContain(ADDRESS);
    expect(text.toLowerCase()).not.toContain("mailto");
  });
  it("is still false for an external posting", () => {
    expect(buildJobPostingJsonLd(job({ source_type: "external", organization_id: null, external_url: "https://careers.acme.test/1" }))?.directApply).toBe(false);
  });
});
