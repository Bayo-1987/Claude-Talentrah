/**
 * The grounding backstop (src/lib/tailoring/grounding.ts) — the mechanism
 * that makes "never invent experience" true regardless of what the model
 * does, not just what the prompt asks for.
 *
 * SABOTAGE-PROOF FIXTURE: this is the real incident, reproduced exactly.
 * 2026-09-06, a real PM/FinTech/HealthTech resume (Quazim Akinwande — no
 * research, statistics, or multi-country people-management background
 * anywhere in it) tailored against a real "Global MEL Manager/Senior
 * Manager" posting at One Acre Fund. The model dropped 15 of 16 real skills
 * and replaced them with a list including Stata, R, Survey Design and
 * Statistical Analysis — none ever claimed by this candidate — and added
 * experience bullets inventing "conducting regular performance reviews and
 * capacity planning" and "standardized integrations across multiple country
 * teams," phrases lifted almost verbatim from the JD's own text. Every
 * string below is a real string from that run, not a synthesized example.
 *
 * WHAT THIS DOES AND DOESN'T PROVE. These are unit tests of the backstop
 * function itself — deterministic, free, and fast, run on every commit.
 * They prove the MECHANISM strips/reverts ungrounded content whenever it's
 * present in a model's output, which is what makes the guarantee hold
 * regardless of model behaviour. They do NOT re-run the real model
 * repeatedly to see whether it drifts toward fabricating differently over
 * time — that would need real, repeated API calls against a shared,
 * free-tier-limited key (see CLAUDE.md on the Gemini quota), which isn't
 * something to spend on every CI run. The backstop is deliberately the
 * layer that doesn't need that: it operates on whatever text comes back,
 * not on trusting the model to keep behaving the same way.
 */
import { describe, expect, it } from "vitest";
import { applyGroundingBackstop, extractJdPhrases, groundExperienceDescriptions, groundSkills } from "@/lib/tailoring/grounding";
import type { StructuredResume } from "@/lib/resume/types";
import { EMPTY_RESUME } from "@/lib/resume/types";

const BASE_RESUME: StructuredResume = {
  ...EMPTY_RESUME,
  contact: { name: "Quazim Akinwande", email: "quazim@example.com" },
  summary: "Product Manager with experience across FinTech and HealthTech, shipping features end to end.",
  skills: [
    "Project Management",
    "Product development",
    "SAFe Agile",
    "Product Marketing",
    "Product (UI/UX) Design",
    "Software Development",
    "APIs",
    "Cloud (AWS, Azure)",
    "AI/ML (Generative AI, OpenAI)",
    "Blockchain Basics",
    "SQL",
    "Analytics (Pendo)",
    "System Design",
    "CI/CD",
    "Scrum",
    "Backlog Prioritization",
  ],
  experience: [
    {
      title: "Product Manager",
      company: "ParallelScore",
      description: "Led product development for a fintech platform, working closely with engineering and design.",
    },
    {
      title: "Senior Product Manager",
      company: "Bankly",
      description: "Owned the roadmap for a savings product used by thousands of customers.",
    },
    {
      title: "Product Manager",
      company: "iRecharge",
      description: "Shipped a new payments feature that increased transaction volume.",
    },
  ],
  projects: [],
  certifications: ["Certified Scrum Product Owner"],
};

// The JD's own extraction — real requirements from the posting, in the same
// shape structuredJd.skills/keywords/responsibilities actually take.
const JD_STRUCTURED = {
  skills: ["Stata", "R", "Survey Design", "Statistical Analysis", "Project Management"],
  keywords: ["quasi-experimental design", "randomized controlled trials", "capacity planning"],
  responsibilities: [
    "owning their goal-setting, performance reviews, development",
    "team-level project and capacity planning",
    "Build and run onboarding and non-technical capacity building",
  ],
};

describe("groundSkills", () => {
  it("keeps a skill that's genuinely on the base resume", () => {
    const { grounded, ungrounded } = groundSkills(["Project Management", "SQL"], BASE_RESUME);
    expect(grounded).toEqual(["Project Management", "SQL"]);
    expect(ungrounded).toEqual([]);
  });

  it("strips every skill this incident actually fabricated", () => {
    const fabricated = ["Stata", "R", "Survey Design", "Statistical Analysis"];
    const { grounded, ungrounded } = groundSkills(fabricated, BASE_RESUME);
    expect(grounded).toEqual([]);
    expect(ungrounded).toEqual(fabricated);
  });

  it("keeps a real skill whose name ends in punctuation — a genuine regression this suite caught", () => {
    // Word-boundary matching is only safe when it accounts for needles that
    // themselves end in a non-word character. An unconditional `\bneedle\b`
    // requires a word-character transition on BOTH edges, and "Analytics
    // (Pendo)" ends in `)` — a haystack that continues with whitespace or
    // nothing after that `)` can never satisfy a trailing `\b`, which would
    // wrongly mark this real, unmodified skill as fabricated.
    const { grounded, ungrounded } = groundSkills(
      ["Analytics (Pendo)", "Cloud (AWS, Azure)", "AI/ML (Generative AI, OpenAI)"],
      BASE_RESUME,
    );
    expect(ungrounded).toEqual([]);
    expect(grounded).toHaveLength(3);
  });

  it("the real run's full replacement skill list: only the one genuinely-grounded term survives", () => {
    const tailoredSkills = [
      "Process Design",
      "Change Management",
      "Knowledge Management",
      "People Management",
      "Remote Team Leadership",
      "Data Analysis",
      "Survey Design",
      "Statistical Analysis",
      "Stata",
      "R",
      "Agile Methodologies",
      "Product Roadmapping",
      "Stakeholder Management",
    ];
    const { grounded, ungrounded } = groundSkills(tailoredSkills, BASE_RESUME);
    // None of these appeared anywhere on the base resume.
    expect(grounded).toEqual([]);
    expect(ungrounded).toHaveLength(tailoredSkills.length);
    expect(ungrounded).toContain("Stata");
    expect(ungrounded).toContain("R");
  });
});

describe("extractJdPhrases", () => {
  it("filters out single words, keeping only real multi-word phrases", () => {
    const phrases = extractJdPhrases({
      skills: ["Stata", "leadership"],
      keywords: ["capacity planning"],
      responsibilities: [],
    });
    expect(phrases).not.toContain("stata");
    expect(phrases).not.toContain("leadership");
    expect(phrases).toContain("capacity planning");
  });
});

describe("groundExperienceDescriptions — the sabotage-proof case", () => {
  it("reverts a Bankly-style entry that lifted 'performance reviews' and 'capacity planning' from the JD", () => {
    const tailored = [
      { ...BASE_RESUME.experience[0] },
      {
        ...BASE_RESUME.experience[1],
        description:
          "Owned the roadmap for a savings product, standardizing integrations across multiple country teams. Managed cross-functional squads, conducting regular performance reviews and capacity planning.",
      },
      { ...BASE_RESUME.experience[2] },
    ];
    const jdPhrases = extractJdPhrases(JD_STRUCTURED);
    const { experience, violations } = groundExperienceDescriptions(tailored, BASE_RESUME, jdPhrases);

    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.index === 1)).toBe(true);
    // Reverted to the candidate's own original text — not a surgical edit,
    // not left as the fabricated version.
    expect(experience[1].description).toBe(BASE_RESUME.experience[1].description);
    expect(experience[1].description).not.toContain("performance reviews");
    expect(experience[1].description).not.toContain("capacity planning");
    expect(experience[1].description).not.toContain("multiple country teams");
  });

  it("leaves a genuinely grounded rephrase alone", () => {
    const tailored = [
      {
        ...BASE_RESUME.experience[0],
        description: "Led product development end to end for a fintech platform, partnering closely with engineering and design.",
      },
      { ...BASE_RESUME.experience[1] },
      { ...BASE_RESUME.experience[2] },
    ];
    const jdPhrases = extractJdPhrases(JD_STRUCTURED);
    const { experience, violations } = groundExperienceDescriptions(tailored, BASE_RESUME, jdPhrases);
    expect(violations).toEqual([]);
    expect(experience[0].description).toContain("Led product development");
  });
});

describe("applyGroundingBackstop — end to end, the full real incident", () => {
  it("produces a resume where none of the fabricated content survives, in either skills or experience", () => {
    const modelOutput: StructuredResume = {
      ...BASE_RESUME,
      skills: [
        "Project Management",
        "Survey Design",
        "Statistical Analysis",
        "Stata",
        "R",
      ],
      experience: [
        {
          ...BASE_RESUME.experience[0],
          description:
            "Designed and documented standardized workflows, enabling consistent delivery across distributed teams.",
        },
        {
          ...BASE_RESUME.experience[1],
          description:
            "Standardized integrations across multiple country teams. Managed cross-functional squads, conducting regular performance reviews and capacity planning.",
        },
        {
          ...BASE_RESUME.experience[2],
          description:
            "Documented rollout procedures, training new staff on system use. Oversaw onboarding of product teams and maintained a knowledge-base for rapid ramp-up.",
        },
      ],
    };

    const { resume, additions } = applyGroundingBackstop(modelOutput, BASE_RESUME, JD_STRUCTURED);

    // None of the fabricated skills reached the auto-applied resume.
    for (const fabricated of ["Survey Design", "Statistical Analysis", "Stata", "R"]) {
      expect(resume.skills).not.toContain(fabricated);
    }
    expect(resume.skills).toContain("Project Management");

    // None of the fabricated experience phrases survived either.
    const allDescriptions = resume.experience.map((e) => e.description ?? "").join(" ");
    for (const phrase of ["performance reviews", "capacity planning", "multiple country teams"]) {
      expect(allDescriptions.toLowerCase()).not.toContain(phrase);
    }

    // Everything stripped/reverted shows up as a reviewable proposal instead
    // of just vanishing — nothing is silently lost, it's silently WITHHELD
    // pending an explicit accept.
    expect(additions.length).toBeGreaterThan(0);
    expect(additions.some((a) => a.section === "skills" && a.text === "Stata")).toBe(true);
    expect(additions.every((a) => a.source === "backstop")).toBe(true);
  });

  it("a resume with no fabrication at all produces zero proposed additions", () => {
    const modelOutput: StructuredResume = {
      ...BASE_RESUME,
      skills: [...BASE_RESUME.skills].reverse(), // reordered, not invented
    };
    const { resume, additions } = applyGroundingBackstop(modelOutput, BASE_RESUME, JD_STRUCTURED);
    expect(additions).toEqual([]);
    expect(resume.skills).toEqual(modelOutput.skills);
  });
});
