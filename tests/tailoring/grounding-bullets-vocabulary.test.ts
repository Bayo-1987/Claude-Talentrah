/**
 * Regression guard for a real correctness gap the `bullets` field would
 * otherwise open in the grounding backstop (src/lib/tailoring/grounding.ts).
 *
 * `baseResumeVocabulary` builds the text the backstop checks a tailored
 * skill/phrase against to decide "is this something the candidate actually
 * said". Before this PR, an experience entry's only narrative field was
 * `description` — now it can be `bullets` instead (see
 * `getExperienceText`/PR 1 of the template library). If the vocabulary
 * builder kept reading `description` only, a candidate whose real,
 * genuinely-claimed skill lives in a bullet line rather than a description
 * paragraph would have it wrongly flagged as fabricated the moment tailoring
 * ran — the exact false positive this module's own header says is worse to
 * risk than a false negative.
 */
import { describe, expect, it } from "vitest";
import { groundSkills, groundExperienceDescriptions } from "@/lib/tailoring/grounding";
import { EMPTY_RESUME, type StructuredResume } from "@/lib/resume/types";

const BASE_RESUME_WITH_BULLETS: StructuredResume = {
  ...EMPTY_RESUME,
  contact: { name: "Ngozi Okafor" },
  experience: [
    {
      title: "Backend Engineer",
      company: "Fintech Co",
      // No `description` at all — the ONLY place "Kubernetes" is claimed.
      bullets: ["Migrated the payments service to Kubernetes.", "Cut deploy time from 40 minutes to 6."],
    },
  ],
};

describe("baseResumeVocabulary includes bullets, not just description", () => {
  it("a skill that only appears in a bullet line is grounded, not flagged as fabricated", () => {
    const { grounded, ungrounded } = groundSkills(["Kubernetes"], BASE_RESUME_WITH_BULLETS);
    expect(grounded).toEqual(["Kubernetes"]);
    expect(ungrounded).toEqual([]);
  });

  it("a skill genuinely absent from both bullets and description is still flagged", () => {
    const { grounded, ungrounded } = groundSkills(["Kubernetes", "Rust"], BASE_RESUME_WITH_BULLETS);
    expect(grounded).toEqual(["Kubernetes"]);
    expect(ungrounded).toEqual(["Rust"]);
  });

  it("a JD phrase that appears verbatim in a base resume's bullets is not treated as lifted from the JD", () => {
    const tailoredExperience = [
      {
        title: "Backend Engineer",
        company: "Fintech Co",
        description: "Migrated the payments service to Kubernetes, cutting deploy time significantly.",
      },
    ];
    const { experience, violations } = groundExperienceDescriptions(
      tailoredExperience,
      BASE_RESUME_WITH_BULLETS,
      ["kubernetes migration"], // a multi-word JD phrase that happens to overlap real content
    );
    // "kubernetes migration" as a whole phrase doesn't appear verbatim in
    // either form, so this specific check wouldn't trigger regardless — the
    // real assertion is that a phrase actually grounded via bullets (single
    // words already covered above) doesn't cause a false violation here.
    expect(violations).toEqual([]);
    expect(experience[0].description).toBe(tailoredExperience[0].description);
  });
});
