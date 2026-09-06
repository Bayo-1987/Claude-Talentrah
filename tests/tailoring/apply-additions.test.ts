/**
 * mergeAcceptedAdditions — the ONLY path a proposedAddition can reach a
 * saved resume through. See src/app/api/tailoring/accept-additions/route.ts
 * for why nothing else can call this.
 */
import { describe, expect, it } from "vitest";
import { mergeAcceptedAdditions } from "@/lib/tailoring/apply-additions";
import { EMPTY_RESUME, type StructuredResume } from "@/lib/resume/types";
import type { ProposedAddition } from "@/lib/tailoring/types";

const RESUME: StructuredResume = {
  ...EMPTY_RESUME,
  skills: ["Project Management", "SQL"],
  experience: [
    { title: "Product Manager", company: "ParallelScore", description: "Original, truthful description." },
    { title: "Senior Product Manager", company: "Bankly", description: "Original Bankly description." },
  ],
};

function addition(overrides: Partial<ProposedAddition>): ProposedAddition {
  return {
    id: "test-1",
    section: "skills",
    text: "",
    reason: "test",
    source: "backstop",
    ...overrides,
  };
}

describe("mergeAcceptedAdditions", () => {
  it("appends an accepted skill that wasn't there before", () => {
    const merged = mergeAcceptedAdditions(RESUME, [addition({ section: "skills", text: "Stata" })]);
    expect(merged.skills).toEqual(["Project Management", "SQL", "Stata"]);
  });

  it("does not duplicate a skill that's already present (case-insensitive)", () => {
    const merged = mergeAcceptedAdditions(RESUME, [addition({ section: "skills", text: "project management" })]);
    expect(merged.skills).toEqual(["Project Management", "SQL"]);
  });

  it("replaces an experience entry's description in full when accepted", () => {
    const merged = mergeAcceptedAdditions(RESUME, [
      addition({ section: "experience", experienceIndex: 1, text: "Farah's rewrite, now accepted." }),
    ]);
    expect(merged.experience[1].description).toBe("Farah's rewrite, now accepted.");
    // The other entry is untouched.
    expect(merged.experience[0].description).toBe("Original, truthful description.");
  });

  it("silently ignores an out-of-range experienceIndex rather than throwing", () => {
    const merged = mergeAcceptedAdditions(RESUME, [
      addition({ section: "experience", experienceIndex: 99, text: "should go nowhere" }),
    ]);
    expect(merged).toEqual(RESUME);
  });

  it("applies multiple accepted items from one call", () => {
    const merged = mergeAcceptedAdditions(RESUME, [
      addition({ section: "skills", text: "Stata" }),
      addition({ section: "skills", text: "R" }),
      addition({ section: "experience", experienceIndex: 0, text: "New accepted text for entry 0." }),
    ]);
    expect(merged.skills).toEqual(["Project Management", "SQL", "Stata", "R"]);
    expect(merged.experience[0].description).toBe("New accepted text for entry 0.");
  });

  it("an empty accepted list changes nothing", () => {
    expect(mergeAcceptedAdditions(RESUME, [])).toEqual(RESUME);
  });

  it("does not mutate the input resume", () => {
    const clone = JSON.parse(JSON.stringify(RESUME));
    mergeAcceptedAdditions(RESUME, [addition({ section: "skills", text: "Stata" })]);
    expect(RESUME).toEqual(clone);
  });
});
