import type { StructuredResume } from "@/lib/resume/types";

/**
 * The resume every template thumbnail is drawn from — AND, since Stage 3.1,
 * what "Start from an example" seeds into a brand-new builder resume
 * (createResumeAction, src/lib/resume-builder/actions.ts).
 *
 * That second job raised the bar on this content. As a thumbnail source it
 * only had to look plausible at 26% scale; as something a real user edits
 * line-by-line, it has to read as genuinely good Nigerian CV writing —
 * quantified impact, not vague duties — because a user copying this
 * *style* is exactly the point of "start from an example" (see the founder's
 * framing: Canva/Enhancv open a filled document to edit, not a blank one).
 * It is also, since the same stage added an export guard
 * (src/lib/resume-builder/example-guard.ts), the exact reference content that
 * guard compares against field-by-field — every value below has to be
 * distinctive enough that a real user's real data won't collide with it by
 * coincidence.
 *
 * A LOCAL LITERAL, deliberately. The gallery needs a resume before the visitor
 * has one — a new user's first sight of the templates is the moment they have
 * nothing saved — so this cannot read from `resumes`, and it must not depend
 * on seed data either: a public-ish gallery that changes when someone edits
 * the demo account, or renders blank in an unseeded environment, is worse than
 * a static picture. The name, employers ("Kolopay", "Riverbend Digital") and
 * email domain are fictional — not real companies or services.
 *
 * SEPARATE FROM C1's SAMPLE_RESUME (src/lib/demo/sample-resume.ts), on
 * purpose, and still on purpose now that both have landed: that one is echoed
 * to anonymous pre-signup callers and tuned to produce a realistic match
 * against a real posting for gap analysis, with empty projects/certifications
 * and no email by design — see that file's own header. This one is fed to a
 * LAYOUT and, now, to an editor a signed-in user fills in — what matters here
 * is that every section is populated and worth reading, not that it matches
 * any particular job posting.
 *
 * EVERY SECTION IS FILLED for the layout reason above: projects and
 * certifications are empty in C1's version and populated here, because two
 * templates in the registry lay those out differently and a thumbnail that
 * omits them would misrepresent the template it is advertising.
 */
export const PREVIEW_SAMPLE_RESUME: StructuredResume = {
  contact: {
    name: "Adaeze Nwachukwu",
    email: "adaeze.nwachukwu@vaultmail.com",
    phone: "+234 803 214 6678",
    location: "Lagos, Nigeria",
  },
  summary:
    "Senior product manager with seven years building payments and fintech products in Lagos, focused on merchant activation, fraud-safe onboarding and measurable revenue impact.",
  experience: [
    {
      title: "Senior Product Manager",
      company: "Kolopay",
      location: "Lagos, Nigeria",
      startDate: "2023",
      endDate: "Present",
      description:
        "Own the merchant payments dashboard used by 40,000+ SMB merchants. Redesigned the KYC intake flow with Compliance and Engineering, cutting median onboarding time from 9 days to 5.4 (a 40% reduction) while holding fraud flags flat.",
    },
    {
      title: "Product Manager",
      company: "Kolopay",
      location: "Lagos, Nigeria",
      startDate: "2021",
      endDate: "2023",
      description:
        "Shipped an in-app dispute-resolution flow that cut average chargeback resolution time by 35% and reduced payment-dispute support tickets by half.",
    },
    {
      title: "Associate Product Manager",
      company: "Riverbend Digital",
      location: "Lagos, Nigeria",
      startDate: "2019",
      endDate: "2021",
      description:
        "Ran 20+ onboarding and activation experiments for SMB merchants on a B2B payments app, lifting 30-day merchant activation from 48% to 61%.",
    },
  ],
  education: [
    { school: "University of Lagos", degree: "B.Sc.", field: "Computer Science", startDate: "2015", endDate: "2019" },
  ],
  skills: [
    "product management",
    "sql",
    "data analysis",
    "user research",
    "roadmapping",
    "agile/scrum",
    "a/b testing",
    "figma",
    "stakeholder management",
    "payments & fintech compliance",
  ],
  projects: [
    "Merchant self-onboarding redesign — cut onboarding time 40%",
    "Chargeback triage automation — 35% faster resolution, adopted company-wide",
    "Premium merchant tier pricing experiment — lifted attach rate 18%",
  ],
  certifications: ["Certified Scrum Product Owner (CSPO)", "Product Management Certificate — Product School"],
};
