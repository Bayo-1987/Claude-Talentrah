import type { StructuredResume } from "./types";

// Generous but real caps — no legitimate name/phone/date/title/company/
// school value is ever this long; a field this size is degenerate model
// output, not data.
const SHORT_FIELD_MAX = 60;
const LONG_FIELD_MAX = 2000;
const LIST_ITEM_MAX = 200;

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
