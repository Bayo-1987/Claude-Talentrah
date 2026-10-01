/**
 * Tailoring-time normalisation: dates read "Sep 2022", near-identical skills
 * collapse to one, and a short list of known terms gets its casing fixed.
 *
 * Pure functions, case tables. They run ONLY on a freshly tailored resume
 * (tailor.ts) — never on every render and never as a migration — so a
 * resume the user wrote themselves is not touched until they tailor it.
 */
import { describe, expect, it } from "vitest";
import {
  KNOWN_SKILL_TERMS,
  normaliseDate,
  normaliseExperienceAchievements,
  normaliseSkills,
  normaliseTailoredDates,
} from "@/lib/tailoring/normalise";

describe("normaliseDate", () => {
  it.each([
    // Month names, any spelling -> "Sep 2022"
    ["September 2022", "Sep 2022"],
    ["Sept 2022", "Sep 2022"],
    ["sep 2022", "Sep 2022"],
    ["SEPT. 2022", "Sep 2022"],
    ["Sep, 2022", "Sep 2022"],
    ["Sep-2022", "Sep 2022"],
    ["Sep 22", "Sep 2022"],
    ["January 2019", "Jan 2019"],
    ["May 2020", "May 2020"],
    ["december 2011", "Dec 2011"],
    // Numeric month/year
    ["09/2022", "Sep 2022"],
    ["9/2022", "Sep 2022"],
    ["09-2022", "Sep 2022"],
    ["09.2022", "Sep 2022"],
    ["2022-09", "Sep 2022"],
    ["2022/9", "Sep 2022"],
    // A day is dropped: a resume date is a month
    ["2022-09-15", "Sep 2022"],
    ["15 September 2022", "Sep 2022"],
    ["September 15, 2022", "Sep 2022"],
    ["Sep 15th, 2022", "Sep 2022"],
    // Year only stays a year
    ["2022", "2022"],
    ["  2022 ", "2022"],
    // Still-in-the-job words
    ["present", "Present"],
    ["Present", "Present"],
    ["CURRENT", "Present"],
    ["Current", "Present"],
    ["now", "Present"],
    ["ongoing", "Present"],
    ["to date", "Present"],
    // Left alone: not a date we can read confidently
    ["03/04/2022", "03/04/2022"], // day/month order is ambiguous
    ["Summer 2021", "Summer 2021"],
    ["Q3 2022", "Q3 2022"],
    ["Fall", "Fall"],
    ["13/2022", "13/2022"], // no month 13
    ["2022-13", "2022-13"],
    ["", ""],
    ["   ", ""],
  ])("%j -> %j", (input, expected) => {
    expect(normaliseDate(input)).toBe(expected);
  });

  it("returns undefined for undefined", () => {
    expect(normaliseDate(undefined)).toBeUndefined();
  });

  it("is idempotent", () => {
    for (const d of ["September 2022", "09/2022", "present", "2022", "Summer 2021"]) {
      const once = normaliseDate(d);
      expect(normaliseDate(once)).toBe(once);
    }
  });
});

describe("normaliseTailoredDates", () => {
  it("normalises start and end of every experience and education entry, and nothing else", () => {
    const out = normaliseTailoredDates({
      contact: { name: "Ada Obi" },
      experience: [
        { title: "PM", company: "Acme", startDate: "September 2022", endDate: "present", description: "Led 09/2022 launch." },
        { title: "Analyst", company: "Beta", startDate: "2019-03", endDate: "Aug 2022" },
      ],
      education: [{ school: "UniLag", startDate: "2012", endDate: "07/2016" }],
      skills: [],
      projects: [],
      certifications: [],
      volunteering: [{ role: "Mentor", organisation: "X", startDate: "September 2020" }],
    });
    expect(out.experience[0]).toMatchObject({ startDate: "Sep 2022", endDate: "Present" });
    // Free text is never rewritten.
    expect(out.experience[0].description).toBe("Led 09/2022 launch.");
    expect(out.experience[1]).toMatchObject({ startDate: "Mar 2019", endDate: "Aug 2022" });
    expect(out.education[0]).toMatchObject({ startDate: "2012", endDate: "Jul 2016" });
    // Fields the tailoring step does not produce are carried through unchanged.
    expect(out.volunteering?.[0].startDate).toBe("September 2020");
  });
});

describe("normaliseExperienceAchievements", () => {
  const role = { title: "PM", company: "Acme" };

  it("splits glued bullets and gives description a plain-text fallback", () => {
    const out = normaliseExperienceAchievements({ ...role, bullets: ["• Shipped A • Cut B"] });
    expect(out.bullets).toEqual(["Shipped A", "Cut B"]);
    expect(out.description).toBe("Shipped A Cut B");
  });

  it("leaves a prose description the model wrote beside real bullets alone", () => {
    const out = normaliseExperienceAchievements({ ...role, bullets: ["Shipped A", "Cut B"], description: "Owned onboarding." });
    expect(out.description).toBe("Owned onboarding.");
  });

  it("does not build a fallback longer than the sanitizer keeps (it would be truncated and the response re-requested)", () => {
    const long = "x".repeat(900);
    const out = normaliseExperienceAchievements({ ...role, bullets: [long, long, long] });
    expect(out.bullets).toEqual([long, long, long]);
    expect(out.description).toBeUndefined();
  });

  it("a prose entry comes back untouched", () => {
    const entry = { ...role, description: "Owned the referrals feature." };
    expect(normaliseExperienceAchievements(entry)).toBe(entry);
  });
});

describe("normaliseSkills", () => {
  it.each([
    // [label, input, expected]
    ["exact duplicate", ["SQL", "SQL"], ["SQL"]],
    ["case-only duplicate of a known term", ["Project Management", "project management"], ["Project Management"]],
    ["hyphen and case variants of one term", ["Project Management", "project management", "Project-Management"], ["Project Management"]],
    ["the variants may arrive in any order", ["project-management", "Project Management"], ["Project Management"]],
    ["wrong casing on a known term is fixed", ["project Management"], ["Project Management"]],
    ["hyphenated known term gets its hyphen", ["product led", "Product-led"], ["Product-Led"]],
    ["known term inside a longer one", ["product-led growth"], ["Product-Led Growth"]],
    ["acronyms are upper-cased", ["sql", "Sql", "api", "seo", "crm"], ["SQL", "API", "SEO", "CRM"]],
    ["brand casing", ["javascript", "typescript", "node.js"], ["JavaScript", "TypeScript", "Node.js"]],
    ["whitespace is trimmed and collapsed", ["  Data   Analysis ", "data analysis"], ["Data Analysis"]],
    ["blank entries are dropped", ["", "  ", "Excel"], ["Excel"]],
    ["order of first appearance is kept", ["Excel", "SQL", "excel", "Python"], ["Excel", "SQL", "Python"]],
    ["unknown terms are left as written, not title-cased", ["design thinking", "Figma"], ["design thinking", "Figma"]],
    // For an unknown term, keep the variant someone capitalised on purpose.
    ["unknown term: prefers the capitalised variant", ["design thinking", "Design Thinking"], ["Design Thinking"]],
    ["unknown term: first wins when neither is capitalised", ["design thinking", "design-thinking"], ["design thinking"]],
    // Different skills that merely look alike must NOT be merged.
    ["Java vs JavaScript are different", ["Java", "JavaScript"], ["Java", "JavaScript"]],
    ["C vs C++ vs C# are different", ["C", "C++", "C#"], ["C", "C++", "C#"]],
    ["Product Management vs Project Management are different", ["Product Management", "Project Management"], ["Product Management", "Project Management"]],
  ])("%s", (_label, input, expected) => {
    expect(normaliseSkills(input)).toEqual(expected);
  });

  it("is idempotent", () => {
    const once = normaliseSkills(["project management", "Project-Management", "sql", "design thinking"]);
    expect(normaliseSkills(once)).toEqual(once);
  });

  it("keeps the known-terms list small and explicit", () => {
    // A deliberately short, reviewable list — a guard against it quietly
    // growing into a dictionary.
    expect(KNOWN_SKILL_TERMS.length).toBeGreaterThan(0);
    expect(KNOWN_SKILL_TERMS.length).toBeLessThanOrEqual(40);
  });
});
