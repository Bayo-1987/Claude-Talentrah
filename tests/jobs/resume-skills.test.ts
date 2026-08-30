/**
 * Expanding a resume's freeform skill entries into matchable terms.
 *
 * ── THE DEFECT ────────────────────────────────────────────────────────────
 *
 * The two sides of the match comparison have always had different producers.
 * Job skills come from a fixed vocabulary tested against the posting text, so
 * they are canonical: `aws`, `agile`, `ui/ux`. Resume skills are whatever the
 * candidate typed. The scorer compared them with `Set.has` on a lowercased
 * string, so these real production entries matched nothing at all:
 *
 *   "SAFe Agile"              vs  agile
 *   "Cloud (AWS, Azure)"      vs  aws, azure
 *   "Product (UI/ UX) Design" vs  ui/ux
 *
 * Two of the four real accounts carry resumes written this way.
 *
 * ── WHAT THESE TESTS ARE MOSTLY GUARDING ──────────────────────────────────
 *
 * Not the expansions — the FALSE ones. A skill wrongly credited inflates a
 * score that Auto-Apply spends real money acting on, and the tempting
 * implementation here is substring matching, under which `sql` is inside
 * "NoSQL" and `hr` is inside "Thruput". Most of what follows is the case
 * against that.
 */
import { describe, expect, it } from "vitest";
import { expandResumeSkills } from "@/lib/matching/resume-skills";
import { computeMatchScore } from "@/lib/matching/score";
import type { StructuredResume } from "@/lib/resume/types";

const expand = (...skills: string[]) => expandResumeSkills(skills);

describe("compound entries, taken from production resumes verbatim", () => {
  it("reaches the canonical term inside a qualified one", () => {
    expect(expand("SAFe Agile")).toContain("agile");
  });

  it("recovers BOTH terms from a parenthesised list", () => {
    // The reason splitting exists at all: normalizeSkillKeyword returns one
    // term, and longest-first would answer "azure" and silently drop "aws".
    const out = expand("Cloud (AWS, Azure)");
    expect(out).toContain("aws");
    expect(out).toContain("azure");
  });

  it("resolves a phrase that only works whole, across the punctuation", () => {
    // Splitting alone gives "product", "ui", " ux", "design" — this one
    // reaches ui/ux because the ORIGINAL string is normalised too.
    expect(expand("Product (UI/ UX) Design")).toContain("ui/ux");
  });

  it("arrives at the same term from either side of a slash", () => {
    expect(expand("UX/UI Design")).toContain("ui/ux");
    expect(expand("UI/UX")).toContain("ui/ux");
  });
});

describe("what must NOT be credited", () => {
  it.each([
    ["NoSQL", "sql"],
    ["Thruput", "hr"],
    ["Emailing", "ai"],
    ["Java", "javascript"],
  ])("%s does not yield %s", (entry, forbidden) => {
    expect(expand(entry)).not.toContain(forbidden);
  });

  it("leaves entries alone when no vocabulary term is present", () => {
    // Every one of these is real, from the two production resumes. Matching
    // them would each require an alias asserting two things are the same
    // skill — a judgement about the market, not a parsing fix.
    for (const entry of ["APIs", "Analytics (Pendo)", "CI/CD", "System Design", "Blockchain Basics"]) {
      expect([...expand(entry)]).toEqual([entry.toLowerCase()]);
    }
  });

  it("does not invent a term from a fragment that means nothing alone", () => {
    expect(expand("AI/ML (Generative AI, OpenAI)")).not.toContain("ai");
  });
});

describe("the guarantee that this can only add", () => {
  it("always keeps the raw lowercased entry", () => {
    // An entry already written canonically must keep matching by exactly the
    // route it did before this existed.
    for (const entry of ["SQL", "Scrum", "Project Management"]) {
      expect(expand(entry)).toContain(entry.toLowerCase());
    }
  });

  it("credits the skill the candidate actually has", () => {
    /*
     * Three requirements, two of them genuinely on the resume. Under the
     * exact-string comparison this replaces, only `sql` matched and the same
     * candidate scored 33 — one third — for a gap they did not have.
     *
     * The absolute number is asserted rather than a comparison, because the
     * comparison this test wants to make is against code that no longer
     * exists to call.
     */
    const resume = {
      skills: ["SAFe Agile", "SQL"],
      experience: [{ title: "Product Manager" }],
    } as unknown as StructuredResume;
    const scored = computeMatchScore(resume, ["agile", "sql", "kubernetes"], undefined);
    expect(scored.score).toBe(67);
    expect(scored.explanation.matchedSkills.sort()).toEqual(["agile", "sql"]);
    expect(scored.explanation.missingSkills).toEqual(["kubernetes"]);
  });

  it("survives a resume whose skills array is empty or ragged", () => {
    expect(expandResumeSkills([]).size).toBe(0);
    expect(expandResumeSkills(["", "   "]).size).toBe(0);
    expect(expandResumeSkills([null as unknown as string, "SQL"])).toContain("sql");
  });
});
