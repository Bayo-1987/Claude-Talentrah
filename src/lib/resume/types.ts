export interface ResumeExperienceEntry {
  title: string;
  company: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
  /**
   * Structured bullet points for this role, ADDED ALONGSIDE `description`
   * rather than replacing it (Template library PR 1 of 3 — schema only,
   * see docs on the template library milestone). `description` stays a
   * single free-text paragraph; `bullets` is the shape a 65-template
   * library actually needs (a PM's shipped outcomes, an engineer's stack
   * list) so it can render as a real bulleted list instead of a wall of
   * text once PR 2's template layouts exist to show it that way.
   *
   * Every reader of an entry's narrative content should go through
   * `getExperienceText` below rather than reading `description` directly —
   * that's what makes the fallback to `description` real for old data
   * instead of a helper nobody calls.
   */
  bullets?: string[];
}

export interface ResumeEducationEntry {
  school: string;
  degree?: string;
  field?: string;
  startDate?: string;
  endDate?: string;
}

/** A single external link — portfolio, GitHub, LinkedIn, a live project. */
export interface ResumeLink {
  label: string;
  url: string;
}

export interface ResumeLanguage {
  name: string;
  level?: string;
}

export interface ResumeVolunteeringEntry {
  role: string;
  organisation: string;
  startDate?: string;
  endDate?: string;
  description?: string;
}

/**
 * A free-form named section with a flat list of items — "Tech Stack",
 * "Shipped", "Open Source", "Impact" and anything else a specific
 * template/industry needs that doesn't warrant its own first-class field.
 * This is deliberately the escape hatch: a 65-template library differentiates
 * a PM from an engineer from a designer largely through sections like this
 * one, not through more first-class fields per profession.
 */
export interface ResumeCustomSection {
  title: string;
  items: string[];
}

export interface StructuredResume {
  contact: {
    name?: string;
    email?: string;
    phone?: string;
    location?: string;
  };
  summary?: string;
  experience: ResumeExperienceEntry[];
  education: ResumeEducationEntry[];
  skills: string[];
  projects: string[];
  certifications: string[];
  /**
   * Every field below is OPTIONAL and simply absent on a resume that
   * doesn't use it — `EMPTY_RESUME` deliberately does not set any of them.
   * Added to widen what a resume can hold for the template library (see
   * `docs/` for the milestone); none of these are read by any template yet
   * (that's PR 2), so populating them today has no visible effect until
   * then.
   */
  links?: ResumeLink[];
  languages?: ResumeLanguage[];
  awards?: string[];
  publications?: string[];
  volunteering?: ResumeVolunteeringEntry[];
  customSections?: ResumeCustomSection[];
  /** True if the resume should show a "References available on request" line instead of listing them. */
  referencesOnRequest?: boolean;
}

export const EMPTY_RESUME: StructuredResume = {
  contact: {},
  experience: [],
  education: [],
  skills: [],
  projects: [],
  certifications: [],
};

export interface ParseResult {
  resume: StructuredResume;
  confidence: "high" | "low";
  usedFallback: boolean;
}

function cleanBullets(bullets: string[] | undefined): string[] | undefined {
  const cleaned = bullets?.map((b) => b.trim()).filter((b) => b.length > 0);
  return cleaned && cleaned.length > 0 ? cleaned : undefined;
}

/**
 * The single place every display site reads an experience entry's narrative
 * content from — never `entry.description` directly. Prefers `bullets` when
 * it holds at least one non-blank line, falling back to `description`
 * otherwise (including for every entry that predates `bullets` entirely).
 *
 * Returns a single display string, unchanged in shape since the schema-widen
 * PR that added it: joining bullets into one line here is what let every
 * existing call site swap this in with no other change back then, and a
 * resume that has only `description` still renders byte-for-byte as it did
 * before `bullets` existed. `getExperienceBullets` below is the real-list
 * counterpart for a renderer that wants an actual `<ul>` instead — added
 * alongside this rather than changing this function's return type, so
 * nothing that already calls this one for plain text (the JD-tailoring demo
 * preview, in particular) needs to change to keep working.
 */
export function getExperienceText(entry: ResumeExperienceEntry): string | undefined {
  const bullets = cleanBullets(entry.bullets);
  if (bullets) {
    return bullets.join(" ");
  }
  return entry.description;
}

/**
 * The raw bullet list for a renderer that wants a real `<ul>` — `undefined`
 * whenever `getExperienceText` would have fallen back to `description`
 * (no bullets, or only blank ones), so the two stay in lockstep: a caller
 * that checks this first and falls back to `getExperienceText`'s string
 * for its `<p>` can never end up rendering neither, or both.
 */
export function getExperienceBullets(entry: ResumeExperienceEntry): string[] | undefined {
  return cleanBullets(entry.bullets);
}
