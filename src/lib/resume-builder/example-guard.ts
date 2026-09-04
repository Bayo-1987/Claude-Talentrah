import type { StructuredResume } from "@/lib/resume/types";
import { PREVIEW_SAMPLE_RESUME } from "./preview-sample";

/**
 * Detects unedited "Start from an example" placeholder content still sitting
 * in a resume — the guard behind "a user emailing a recruiter a CV that still
 * says the example email is a worse outcome than the blank-page problem this
 * feature exists to fix" (Stage 3.1 brief).
 *
 * MECHANISM: exact-value comparison against PREVIEW_SAMPLE_RESUME
 * (src/lib/resume-builder/preview-sample.ts), field by field. No schema
 * change, no "was this seeded from the example" flag stored anywhere — a
 * flag can drift from the truth the moment content is edited back to
 * something that happens to match, and can also be wrong forever if a
 * migration or a future write path forgets to set it. An exact-value
 * comparison can't drift: it is checking the one thing that actually
 * matters (does this content still read as the example), computed fresh
 * every time.
 *
 * WHY THIS DOESN'T FALSE-POSITIVE ON A BLANK OR FRESHLY-IMPORTED RESUME:
 * every check below only fires when the CURRENT value is present AND equals
 * the specific example value — a blank field is skipped (nothing to
 * compare), and a real person's real details are astronomically unlikely to
 * collide with fictional strings like "Adaeze Nwachukwu" or
 * "adaeze.nwachukwu@paystack-alum.com" verbatim. Skills/projects/
 * certifications are flagged only when the WHOLE list is still identical to
 * the example's — adding, removing, or reordering even one item clears the
 * flag for that section, by design: "still has example content" should mean
 * "never touched", not "still contains one item that happens to overlap".
 */
export interface ExampleFieldFlag {
  /** Machine-stable path, useful for tests. */
  path: string;
  /** Human-readable name for the "update X before exporting" message. */
  label: string;
}

function isNonEmpty(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function sameList(a: string[], b: string[]): boolean {
  return a.length > 0 && a.length === b.length && a.every((item, i) => item === b[i]);
}

export function findUneditedExampleFields(content: StructuredResume): ExampleFieldFlag[] {
  const example = PREVIEW_SAMPLE_RESUME;
  const flags: ExampleFieldFlag[] = [];

  if (isNonEmpty(content.contact.name) && content.contact.name === example.contact.name) {
    flags.push({ path: "contact.name", label: "name" });
  }
  if (isNonEmpty(content.contact.email) && content.contact.email === example.contact.email) {
    flags.push({ path: "contact.email", label: "email" });
  }
  if (isNonEmpty(content.contact.phone) && content.contact.phone === example.contact.phone) {
    flags.push({ path: "contact.phone", label: "phone number" });
  }
  if (isNonEmpty(content.contact.location) && content.contact.location === example.contact.location) {
    flags.push({ path: "contact.location", label: "location" });
  }
  if (isNonEmpty(content.summary) && content.summary === example.summary) {
    flags.push({ path: "summary", label: "summary" });
  }

  content.experience.forEach((entry, i) => {
    const isExampleEntry = example.experience.some(
      (ex) =>
        isNonEmpty(entry.title) &&
        isNonEmpty(entry.company) &&
        entry.title === ex.title &&
        entry.company === ex.company &&
        entry.description === ex.description,
    );
    if (isExampleEntry) {
      flags.push({ path: `experience.${i}`, label: `work history entry "${entry.title}"` });
    }
  });

  content.education.forEach((entry, i) => {
    const isExampleEntry = example.education.some(
      (ex) => isNonEmpty(entry.school) && entry.school === ex.school && entry.degree === ex.degree,
    );
    if (isExampleEntry) {
      flags.push({ path: `education.${i}`, label: `education entry "${entry.school}"` });
    }
  });

  if (sameList(content.skills, example.skills)) {
    flags.push({ path: "skills", label: "skills list" });
  }
  if (sameList(content.projects, example.projects)) {
    flags.push({ path: "projects", label: "projects list" });
  }
  if (sameList(content.certifications, example.certifications)) {
    flags.push({ path: "certifications", label: "certifications list" });
  }

  return flags;
}

export function hasUneditedExampleContent(content: StructuredResume): boolean {
  return findUneditedExampleFields(content).length > 0;
}

/** The user-facing message for the export/Auto-Apply block. */
export function describeExampleGuardError(flags: ExampleFieldFlag[]): string {
  const labels = flags.map((f) => f.label);
  const list =
    labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return `Your ${list} — still the example value${labels.length > 1 ? "s" : ""} from "Start from an example". Update ${
    labels.length > 1 ? "them" : "it"
  } before exporting.`;
}
