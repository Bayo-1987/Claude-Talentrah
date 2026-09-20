/**
 * send-377 — eligibility_other can now hold bold/italic markdown syntax
 * (admin-scholarship-form.tsx's MinimalRichEditor). checkEligibility's own
 * grounding string (describeScholarship, farah.ts) must still receive PLAIN
 * text — a model comparing against literal `**`/`*` characters is comparing
 * against noise the applicant never actually wrote, same rule send-373's
 * screening-answer grading already follows (farah-review.ts's own
 * stripInlineMarkdown call).
 *
 * describeScholarship is a pure function (no DB, no LLM call) — exported
 * specifically so this grounding string can be asserted on directly rather
 * than mocking generateWithFailover just to inspect its own prompt.
 */
import { describe, expect, it } from "vitest";
import { describeScholarship } from "@/lib/scholarships/farah";
import type { Tables } from "@/lib/supabase/types";

type ScholarshipRow = Tables<"scholarships">;

const BASE: ScholarshipRow = {
  id: "s1",
  application_deadline: "2027-03-31",
  created_at: "2026-01-01T00:00:00Z",
  cycle_year: 2027,
  deadline_note: null,
  deadline_verified_at: null,
  dedup_fingerprint: "fp",
  degree_levels: ["msc"],
  eligibility_age: null,
  eligibility_nationalities: ["Nigeria"],
  eligibility_other: null,
  eligibility_prior_degree: null,
  field_tags: ["Engineering"],
  funding_covers: ["Tuition", "Stipend"],
  funding_type: "full",
  host_institution: "Example University",
  last_checked_at: "2026-01-01T00:00:00Z",
  moderated_at: null,
  moderated_by: null,
  moderation_note: null,
  moderation_status: "verified",
  official_url: "https://example.edu/scholarship",
  program_name: "Example Masters Programme",
  provider: "Example Provider",
  source_name: "Manual entry",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("describeScholarship's grounding string strips markdown from eligibility_other", () => {
  it("a real formatted admin value renders as plain text in the grounding string", () => {
    // The exact shape a real quoted-provider-text admin entry looks like:
    // bold for the hard requirement, italic for a qualifying clause.
    const scholarship: ScholarshipRow = {
      ...BASE,
      eligibility_other:
        "**Must hold a first-class or strong second-class degree.** Preference given to *first-generation university students*.",
    };

    const grounding = describeScholarship(scholarship);

    expect(grounding).toContain(
      "Other stated requirements: Must hold a first-class or strong second-class degree. Preference given to first-generation university students.",
    );
    expect(grounding).not.toContain("**");
    expect(grounding).not.toContain("*Must");
    expect(grounding).not.toContain("*first-generation");
  });

  it("REGRESSION: a plain scraped value (no markdown syntax at all) is unchanged", () => {
    // sources.config.ts's real values today — hand-typed plain English, no
    // markdown syntax. stripInlineMarkdown must be a no-op on these, not
    // accidentally eat a real asterisk that was never a formatting marker.
    const scholarship: ScholarshipRow = {
      ...BASE,
      eligibility_other: "Open to Nigerian citizens; oil-and-gas-relevant disciplines prioritised.",
    };

    const grounding = describeScholarship(scholarship);

    expect(grounding).toContain(
      "Other stated requirements: Open to Nigerian citizens; oil-and-gas-relevant disciplines prioritised.",
    );
  });

  it("omits the line entirely when eligibility_other is null (unchanged behavior)", () => {
    const grounding = describeScholarship({ ...BASE, eligibility_other: null });
    expect(grounding).not.toContain("Other stated requirements");
  });
});
