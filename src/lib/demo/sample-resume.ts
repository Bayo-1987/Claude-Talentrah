import type { StructuredResume } from "@/lib/resume/types";

/**
 * The resume a visitor with no account is tailored against.
 *
 * A LITERAL, deliberately — not `scripts/seed.ts`'s DEMO_RESUME and not a read
 * of the demo account's row. Both would make a public, unauthenticated
 * endpoint depend on seed data: the endpoint would change behaviour when
 * someone edits the demo account, break in any environment that was never
 * seeded, and require a database round trip on the landing page's hot path to
 * fetch a constant. Sharing the Lagos fintech-PM persona keeps the story
 * consistent across the marketing surface; sharing the CODE would couple two
 * things that only look alike.
 *
 * It also backs the demo's own framing: the result panel says "Scored against
 * a sample resume", and this endpoint genuinely does score against this
 * constant.
 *
 * NOT the homepage job-board grid. `job-board-preview.tsx`'s sample rows and
 * their 92/78/63 scores are hardcoded illustrations that never came from this
 * resume. That block used to say its scores were "calculated against a sample
 * resume", which was untrue of it; it now labels itself as example listings
 * with fictional roles and scores (send-476). Making those numbers real would
 * mean scoring sample postings against SAMPLE_RESUME at build time — a separate
 * change, and not needed while the block is honestly labelled.
 */
export const SAMPLE_RESUME: StructuredResume = {
  contact: {
    name: "Sample Candidate",
    location: "Lagos, Nigeria",
  },
  summary:
    "Product-minded operator with 4 years across fintech and payments, focused on activation, retention, and merchant experience.",
  experience: [
    {
      title: "Product Manager",
      company: "A Lagos fintech",
      location: "Lagos, Nigeria",
      startDate: "2022",
      endDate: "Present",
      description:
        "Led product strategy for a merchant payments dashboard, driving stakeholder alignment across compliance, ops, and executive leadership.",
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
  education: [{ school: "University of Lagos", degree: "B.Sc.", field: "Computer Science" }],
  skills: [
    "product management",
    "stakeholder management",
    "sql",
    "data analysis",
    "user research",
    "roadmapping",
    "agile",
    "payments",
  ],
  projects: [],
  certifications: [],
};

/**
 * No contact email, on purpose. The tailored output is handed straight back to
 * an anonymous caller, so anything in this constant is public — and a real
 * address here would be echoed into every demo response. The persona has a
 * name and a city because the model needs a person to write about; it does not
 * need a way to reach them.
 */
