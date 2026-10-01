import type { StructuredResume } from "@/lib/resume/types";

/**
 * A resume that prints to MORE THAN ONE PAGE on every template, with 18
 * certifications (past the 8-entry two-column threshold) and real bulleted
 * achievements. Shared by the QA-only `/dev/resume-print-fixture/[template]`
 * route and `e2e/resume-print-margins.spec.ts`, which prints it with
 * `page.pdf()` and measures the white space at the page breaks — the same
 * "test the page a human can also open" arrangement as `ats-test-fixture.ts`.
 *
 * Every bullet carries a unique `ZQB<n>` marker so a test can count how many
 * of them survived into a PDF as separate list items.
 */
const ROLE_BULLETS = (role: number): string[] =>
  [1, 2, 3, 4].map(
    (n) =>
      `ZQB${role}${n} Delivered a measurable improvement to the ${["settlement", "onboarding", "reporting", "reconciliation"][n - 1]} workflow, ` +
      `working with finance, operations and engineering to cut cycle time and error rates across the whole team.`,
  );

export const PRINT_FIXTURE_ROLE_COUNT = 4;
export const PRINT_FIXTURE_BULLET_COUNT = PRINT_FIXTURE_ROLE_COUNT * 4;
export const PRINT_FIXTURE_CERTIFICATION_COUNT = 18;
export const PRINT_FIXTURE_PROJECT_COUNT = 2;

/**
 * The same four roles as they come back from a sloppy tailoring response, before
 * `normaliseTailoredResume`: every other role has its four achievements glued
 * into ONE bullet string behind "•" characters, the rest carry them as dash
 * lines in `description`. `/dev/resume-print-fixture/<t>?source=tailored`
 * normalises this, so the e2e can follow bullets from LLM-shaped output all
 * the way into a PDF.
 */
function rawTailoredResume(resume: StructuredResume): StructuredResume {
  return {
    ...resume,
    experience: resume.experience.map((entry, i) => {
      const bullets = entry.bullets ?? [];
      return i % 2 === 0
        ? { ...entry, bullets: [bullets.map((b) => `• ${b}`).join(" ")] }
        : { ...entry, bullets: undefined, description: bullets.map((b) => `- ${b}`).join("\n") };
    }),
  };
}

export const PRINT_FIXTURE_RESUME: StructuredResume = {
  contact: {
    name: "Ada Obi",
    email: "ada.obi@example.com",
    phone: "+234 800 555 0100",
    location: "Lagos, Nigeria",
  },
  summary:
    "Operations and payments lead with ten years of experience running settlement, reconciliation and reporting " +
    "teams across Nigerian fintech. Known for turning slow manual processes into reliable, audited ones.",
  experience: [
    { title: "Head of Operations", company: "Northbridge Systems", location: "Lagos", startDate: "Sep 2022", endDate: "Present", bullets: ROLE_BULLETS(1) },
    { title: "Senior Operations Manager", company: "Kora Payments", location: "Abuja", startDate: "Jan 2019", endDate: "Aug 2022", bullets: ROLE_BULLETS(2) },
    { title: "Operations Manager", company: "Paystack Partners", location: "Lagos", startDate: "Mar 2016", endDate: "Dec 2018", bullets: ROLE_BULLETS(3) },
    { title: "Reconciliation Lead", company: "Interswitch Group", location: "Lagos", startDate: "Jun 2013", endDate: "Feb 2016", bullets: ROLE_BULLETS(4) },
  ],
  education: [
    { school: "University of Lagos", degree: "MBA", field: "Operations", startDate: "2015", endDate: "2017" },
    { school: "University of Ibadan", degree: "B.Sc.", field: "Accounting", startDate: "2006", endDate: "2010" },
  ],
  skills: [
    "Project Management",
    "Process Improvement",
    "Payments Operations",
    "Financial Reconciliation",
    "Stakeholder Management",
    "SQL",
    "Excel",
    "Vendor Management",
    "Risk and Controls",
    "Team Leadership",
  ],
  projects: [
    "Settlement automation: replaced a nightly spreadsheet process with an audited pipeline.",
    "Chargeback dashboard: gave support a single view of dispute status and deadlines.",
  ],
  certifications: Array.from(
    { length: PRINT_FIXTURE_CERTIFICATION_COUNT },
    (_, i) => `ZQCERT${String(i + 1).padStart(2, "0")} Professional Certification Number ${i + 1}, Issuing Body ${i + 1} (${2010 + (i % 14)})`,
  ),
};

export const PRINT_FIXTURE_TAILORED_RAW: StructuredResume = rawTailoredResume(PRINT_FIXTURE_RESUME);
