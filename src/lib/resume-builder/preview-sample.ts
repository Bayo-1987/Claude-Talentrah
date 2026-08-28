import type { StructuredResume } from "@/lib/resume/types";

/**
 * The resume every template thumbnail is drawn from.
 *
 * A LOCAL LITERAL, deliberately. The gallery needs a resume before the visitor
 * has one — a new user's first sight of the templates is the moment they have
 * nothing saved — so this cannot read from `resumes`, and it must not depend
 * on seed data either: a public-ish gallery that changes when someone edits
 * the demo account, or renders blank in an unseeded environment, is worse than
 * a static picture.
 *
 * SEPARATE FROM C1's SAMPLE_RESUME, on purpose and only for now. That constant
 * lives on the unmerged pre-signup-demo branch and serves a different job:
 * it is fed to a model for gap analysis, so its skills list is tuned to
 * produce a realistic match against a real posting. This one is fed to a
 * LAYOUT, so what matters is that every section is populated — a template with
 * an empty education block looks broken rather than minimal, and a thumbnail's
 * whole purpose is showing what the layout does with content.
 *
 * They may well converge once both land. Worth consolidating then, on a look
 * at both; not worth blocking either on the other now.
 *
 * EVERY SECTION IS FILLED for that reason: projects and certifications are
 * empty in C1's version and populated here, because two templates in the
 * registry lay those out differently and a thumbnail that omits them would
 * misrepresent the template it is advertising.
 */
export const PREVIEW_SAMPLE_RESUME: StructuredResume = {
  contact: {
    name: "Sample Candidate",
    email: "sample@example.com",
    phone: "+234 800 000 0000",
    location: "Lagos, Nigeria",
  },
  summary:
    "Product-minded operator with four years across fintech and payments, focused on activation, retention and merchant experience.",
  experience: [
    {
      title: "Product Manager",
      company: "A Lagos fintech",
      location: "Lagos, Nigeria",
      startDate: "2022",
      endDate: "Present",
      description:
        "Led the merchant payments dashboard, aligning compliance, operations and engineering around one roadmap.",
    },
    {
      title: "Associate Product Manager",
      company: "A payments startup",
      location: "Lagos, Nigeria",
      startDate: "2020",
      endDate: "2022",
      description: "Owned onboarding and activation experiments for SMB merchants.",
    },
  ],
  education: [
    { school: "University of Lagos", degree: "B.Sc.", field: "Computer Science", startDate: "2016", endDate: "2020" },
  ],
  skills: ["product management", "sql", "data analysis", "user research", "roadmapping", "agile"],
  projects: ["Merchant self-onboarding pilot", "Chargeback triage workflow"],
  certifications: ["Certified Scrum Product Owner"],
};
