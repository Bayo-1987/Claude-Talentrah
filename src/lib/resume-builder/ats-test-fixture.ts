import type { StructuredResume } from "@/lib/resume/types";

/**
 * The ONE resume every skeleton's ATS-safety claim is checked against —
 * shared by `src/app/dev/template-skeletons/[configKey]/page.tsx` (what a
 * real browser prints to a real PDF) and
 * `e2e/ats-safety.spec.ts` (what asserts on the extracted
 * text). Sharing the fixture is the point: the test has to be checking the
 * exact page a human could also go look at, not a fixture that only lives
 * inside the test file.
 *
 * EVERY SECTION'S TEXT CARRIES A DISTINCT, GREPPABLE MARKER
 * (`ZQEXPERIENCE`, `ZQEDUCATION`, ...) so the test can find each section's
 * position in the extracted text with `indexOf` and compare positions,
 * rather than guessing from prose that could plausibly appear in more than
 * one place. The `ZQ` prefix exists so a marker can never collide with real
 * words elsewhere in the fixture (plain English section names like
 * "Skills" or "Education" also appear as HEADINGS, which would make an
 * `indexOf` on the word itself ambiguous between the heading and the body).
 */
export const ATS_TEST_RESUME: StructuredResume = {
  contact: {
    name: "ZQNAME Chidinma Eze",
    email: "chidinma@example.com",
    phone: "+234 800 555 0100",
    location: "Abuja, Nigeria",
  },
  summary: "ZQSUMMARY Backend engineer focused on payments infrastructure and reliability.",
  experience: [
    {
      title: "ZQEXPERIENCE Staff Engineer",
      company: "Northbridge Systems",
      location: "Abuja, Nigeria",
      startDate: "2022",
      endDate: "Present",
      bullets: ["ZQEXPERIENCEBODY Led the migration of the settlement ledger to an event-sourced model."],
    },
  ],
  education: [
    { school: "ZQEDUCATION University of Abuja", degree: "B.Sc.", field: "Computer Science", startDate: "2014", endDate: "2018" },
  ],
  skills: ["ZQSKILLS Postgres", "ZQSKILLS Kafka", "ZQSKILLS Go"],
  projects: ["ZQPROJECTS Ledger replay tool — cut incident triage time in half."],
  certifications: ["ZQCERTIFICATIONS AWS Certified Solutions Architect"],
  links: [{ label: "ZQLINKS Portfolio", url: "https://example.com/chidinma" }],
  languages: [{ name: "ZQLANGUAGES Igbo", level: "Native" }],
  awards: ["ZQAWARDS Engineering Excellence Award, Northbridge (2024)"],
};

/** Every marker `ATS_TEST_RESUME` plants, in the order a human reads the source resume — NOT the order any particular layout renders them in. The test uses this list to check whichever markers a given skeleton's demo config actually surfaces. */
export const ATS_TEST_MARKERS = [
  "ZQNAME",
  "ZQSUMMARY",
  "ZQEXPERIENCE",
  "ZQEXPERIENCEBODY",
  "ZQEDUCATION",
  "ZQSKILLS",
  "ZQPROJECTS",
  "ZQCERTIFICATIONS",
  "ZQLINKS",
  "ZQLANGUAGES",
  "ZQAWARDS",
] as const;
