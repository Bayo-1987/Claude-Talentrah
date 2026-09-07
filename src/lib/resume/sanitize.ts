import type {
  ResumeCustomSection,
  ResumeLanguage,
  ResumeLink,
  ResumeVolunteeringEntry,
  StructuredResume,
} from "./types";

// Generous but real caps — no legitimate name/phone/date/title/company/
// school value is ever this long; a field this size is degenerate model
// output, not data.
const SHORT_FIELD_MAX = 60;
const LONG_FIELD_MAX = 2000;
const LIST_ITEM_MAX = 200;
// URLs legitimately run longer than any other "short" field (tracking
// params, long portfolio slugs) — a separate, more generous cap rather than
// reusing SHORT_FIELD_MAX, which would drop nearly every real link.
const URL_MAX = 500;

function cleanShort(value: string | undefined): string | undefined {
  if (!value) return value;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= SHORT_FIELD_MAX ? trimmed : undefined;
}

function cleanLong(value: string | undefined): string | undefined {
  if (!value) return value;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.length <= LONG_FIELD_MAX ? trimmed : trimmed.slice(0, LONG_FIELD_MAX) + "…";
}

function cleanListItems(items: string[]): string[] {
  return items
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= LIST_ITEM_MAX);
}

function cleanUrl(value: string | undefined): string | undefined {
  if (!value) return value;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= URL_MAX ? trimmed : undefined;
}

/**
 * Every new optional array field below shares the same "absent means
 * unused" convention `EMPTY_RESUME` establishes: an input of `undefined`
 * stays `undefined`, and a result with nothing left in it after cleaning
 * collapses back to `undefined` rather than an empty array — a resume with
 * `awards: []` and one with no `awards` key at all render identically, so
 * there's no reason for sanitizing to manufacture a distinction that wasn't
 * there before.
 */
function cleanOptionalStringList(items: string[] | undefined): string[] | undefined {
  if (!items) return undefined;
  const cleaned = cleanListItems(items);
  return cleaned.length > 0 ? cleaned : undefined;
}

function cleanLinks(links: ResumeLink[] | undefined): ResumeLink[] | undefined {
  if (!links) return undefined;
  const cleaned = links
    .map((link) => ({ label: cleanShort(link.label) ?? "", url: cleanUrl(link.url) ?? "" }))
    .filter((link) => link.label.length > 0 && link.url.length > 0);
  return cleaned.length > 0 ? cleaned : undefined;
}

function cleanLanguages(languages: ResumeLanguage[] | undefined): ResumeLanguage[] | undefined {
  if (!languages) return undefined;
  const cleaned = languages
    .map((lang) => ({ name: cleanShort(lang.name) ?? "", level: cleanShort(lang.level) }))
    .filter((lang) => lang.name.length > 0);
  return cleaned.length > 0 ? cleaned : undefined;
}

function cleanVolunteering(
  entries: ResumeVolunteeringEntry[] | undefined,
): ResumeVolunteeringEntry[] | undefined {
  if (!entries) return undefined;
  const cleaned = entries
    .map((entry) => ({
      role: cleanShort(entry.role) ?? "",
      organisation: cleanShort(entry.organisation) ?? "",
      startDate: cleanShort(entry.startDate),
      endDate: cleanShort(entry.endDate),
      description: cleanLong(entry.description),
    }))
    .filter((entry) => entry.role.length > 0 || entry.organisation.length > 0);
  return cleaned.length > 0 ? cleaned : undefined;
}

function cleanCustomSections(
  sections: ResumeCustomSection[] | undefined,
): ResumeCustomSection[] | undefined {
  if (!sections) return undefined;
  const cleaned = sections
    .map((section) => ({
      title: cleanShort(section.title) ?? "",
      items: cleanListItems(section.items ?? []),
    }))
    .filter((section) => section.title.length > 0 && section.items.length > 0);
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Defends against a real, observed LLM structured-output failure mode
 * (gemini-3.6-flash, caught via live testing, not theoretical): an
 * ambiguous "what do I output for a field the base resume doesn't have"
 * decision occasionally spirals into hundreds of words of repetitive
 * filler instead of an empty string — e.g. a phone field containing
 * paragraphs of "...standard fallback logic context parameters properly
 * handle default value..." Any field far longer than its semantic type
 * could legitimately be gets dropped rather than kept — even truncated,
 * it would still show garbled prose, and "leave it empty" already matches
 * this app's existing "don't guess" convention for missing resume data.
 */
export function sanitizeStructuredResume(resume: StructuredResume): StructuredResume {
  return {
    contact: {
      name: cleanShort(resume.contact.name),
      email: cleanShort(resume.contact.email),
      phone: cleanShort(resume.contact.phone),
      location: cleanShort(resume.contact.location),
    },
    summary: cleanLong(resume.summary),
    experience: resume.experience.map((entry) => ({
      title: cleanShort(entry.title) ?? "",
      company: cleanShort(entry.company) ?? "",
      location: cleanShort(entry.location),
      startDate: cleanShort(entry.startDate),
      endDate: cleanShort(entry.endDate),
      description: cleanLong(entry.description),
      bullets: cleanOptionalStringList(entry.bullets),
    })),
    education: resume.education.map((entry) => ({
      school: cleanShort(entry.school) ?? "",
      degree: cleanShort(entry.degree),
      field: cleanShort(entry.field),
      startDate: cleanShort(entry.startDate),
      endDate: cleanShort(entry.endDate),
    })),
    skills: cleanListItems(resume.skills),
    projects: cleanListItems(resume.projects),
    certifications: cleanListItems(resume.certifications),
    links: cleanLinks(resume.links),
    languages: cleanLanguages(resume.languages),
    awards: cleanOptionalStringList(resume.awards),
    publications: cleanOptionalStringList(resume.publications),
    volunteering: cleanVolunteering(resume.volunteering),
    customSections: cleanCustomSections(resume.customSections),
    // Not a text field — nothing here can spiral into degenerate filler the
    // way a string field can, so it passes through unchanged.
    referencesOnRequest: resume.referencesOnRequest,
  };
}

/**
 * True if sanitizing actually had to drop/truncate something — i.e. the raw
 * model output was degenerate. Callers use this to decide whether a single
 * retry is worth attempting before falling back to the sanitized (some
 * fields now empty) result.
 */
export function wasDegenerate(raw: StructuredResume, cleaned: StructuredResume): boolean {
  return stableStringify(raw) !== stableStringify(cleaned);
}

/**
 * JSON.stringify with object keys sorted, so comparison is by content rather
 * than by key insertion order. Array order is preserved — it's semantic
 * (experience entries are chronological); only object key order is noise.
 *
 * This existed as a plain JSON.stringify comparison and fired on EVERY
 * tailoring call, doubling the LLM spend and latency of the single
 * most expensive credit action:
 *
 *   raw     = { ...EMPTY_RESUME, ...modelOutput }
 *   cleaned = sanitizeStructuredResume(raw)
 *
 * EMPTY_RESUME has no `summary` key, so spreading the model's output
 * appended `summary` LAST, while sanitizeStructuredResume rebuilds the
 * object with `summary` SECOND. Two objects with byte-identical values
 * therefore serialized differently, wasDegenerate() returned true, and the
 * caller retried — on good output, every time. Nothing to do with the
 * model, the prompt, or the provider: it was pure key ordering.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    // Match JSON.stringify's own behaviour: a key whose value is undefined
    // is omitted entirely, not serialized as null.
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}
