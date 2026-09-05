import type { StructuredJD, WorkType, SeniorityLevel } from "./types";

/** Small curated vocabulary — enough to drive M3's algorithmic match scoring
 * without needing an LLM call per job at ingestion time. Extend as needed.
 *
 * Exported since the course catalog keys on it: `course_recommendations.skill_tag`
 * holds terms from this list, and src/lib/courses/normalize.ts maps freeform
 * gap-analysis keywords onto it. One vocabulary, two readers — a second copy
 * would drift, and the drift would look like "no course for that skill". */
export const SKILL_VOCABULARY = [
  "javascript",
  "typescript",
  "python",
  "java",
  "sql",
  "react",
  "node.js",
  "next.js",
  "aws",
  "gcp",
  "azure",
  "kubernetes",
  "docker",
  "graphql",
  "rest api",
  "product management",
  "agile",
  "scrum",
  "stakeholder management",
  "data analysis",
  "figma",
  "ui/ux",
  "sales",
  "business development",
  "customer success",
  "salesforce",
  "hubspot",
  "digital marketing",
  "seo",
  "content marketing",
  "financial modeling",
  "accounting",
  "compliance",
  "risk management",
  "recruiting",
  "hr",
  "payroll",
  "supply chain",
  "logistics",
  "operations",
  "project management",
  "leadership",
  "communication",
  "negotiation",
  "excel",
  "power bi",
  "tableau",
];

/**
 * Vocabulary terms that a resume's `skills` array cannot be screened against.
 *
 * These are still EXTRACTED — a posting that asks for communication really did
 * ask for it, and gap analysis, cover letters and the keyword list all have a
 * legitimate use for that. What they are not is a *requirement a candidate can
 * be measured against*, so `computeMatchScore` drops them before dividing.
 * Extraction keeps the information; scoring declines to score on it.
 *
 * ── THE EVIDENCE ──────────────────────────────────────────────────────────
 *
 * Measured on production, 155 open postings and all 642 rows of match_scores:
 *
 *   communication   88 postings  56.8%   matched 0 times, ever
 *   operations      65 postings  41.9%   matched 0 times, ever
 *   leadership      55 postings  35.5%   matched 0 times, ever
 *   ── the cliff ──
 *   sql             38 postings  24.5%   matched 119 times
 *   agile           23 postings  14.8%   matched  25 times
 *
 * Hard skills demonstrably match, so this is not a broken comparison. It is
 * three terms that are tagged on most of the board and satisfied by nobody,
 * sitting in the denominator of every score. A posting asking for six things
 * of which three are these could return at most 50% coverage however well
 * qualified the candidate was.
 *
 * ── WHY THIS IS A LIST, WHEN skill-facet.ts ARGUES AGAINST LISTS ──────────
 *
 * The facet hit the same three terms and deliberately suppressed them by SHARE
 * of the board rather than by name, because the alternative there was an
 * allowlist of "real" technologies — unbounded, churning with every new
 * framework, and silently dropping real skills as it went stale.
 *
 * That argument does not transfer, for a reason worth stating rather than
 * assuming. This is not a new taxonomy: it is a subset of SKILL_VOCABULARY,
 * which is already hand-maintained directly above, and nothing can enter this
 * set that is not already in that list. A term is added here at the same
 * moment it is added there, by the same person, in the same file.
 * tests/unit/matching/score.test.ts fails if the two ever disagree.
 *
 * Share is also the wrong instrument HERE specifically, even though it is the
 * right one for the facet. A match score is persisted per (user, job) and read
 * back by Auto-Apply; deriving it from the composition of the surrounding
 * board would make the same job score differently depending on what else had
 * been ingested that week, and a threshold that moves under a stored,
 * gate-carrying number is worse than a list somebody has to edit.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ─────────────────────────────────────────
 *
 * `sales` (36 postings), `compliance` (30) and `customer success` (21) have
 * also never matched, and they are NOT in this set. They are screenable domain
 * skills that this particular handful of users happens not to have — a fact
 * about four resumes, not about the terms. Adding them would start converting
 * "nobody here has it" into "nobody can be asked for it", which is how a
 * measured fix becomes a curated taxonomy.
 *
 * `negotiation` is a trait by any reading and is also not here: at 5 postings
 * it is 3.2% of the board and poisons nothing. It earns a place if it ever
 * reaches the share the three above sit at.
 */
export const NON_SCREENABLE_SKILLS: ReadonlySet<string> = new Set([
  "communication",
  "leadership",
  "operations",
]);

/**
 * Some source HTML is double-escaped (`&amp;nbsp;` for a literal `&nbsp;`) —
 * decoding &amp; first unmasks those before the other entities run, so a
 * single pass catches both single- and double-escaped forms.
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/**
 * Some ATS APIs (Greenhouse) return the description as HTML-entity-encoded
 * HTML — i.e. the tags themselves are escaped (`&lt;p&gt;`), not real markup
 * — so entities must be decoded before tags can be stripped, not after.
 */
export function stripHtml(html: string): string {
  const decoded = decodeHtmlEntities(html);
  return decoded
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractResponsibilities(plainText: string): string[] {
  return plainText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("• "))
    .map((l) => l.slice(2).trim())
    .filter((l) => l.length > 10 && l.length < 200)
    .slice(0, 8);
}

export function extractStructuredJd(plainText: string): StructuredJD {
  const lower = plainText.toLowerCase();
  const skills = SKILL_VOCABULARY.filter((skill) =>
    new RegExp(`\\b${skill.replace(/[.+]/g, "\\$&")}\\b`, "i").test(lower),
  );

  return {
    skills,
    keywords: skills, // same vocabulary hit-list doubles as keywords for now
    responsibilities: extractResponsibilities(plainText),
  };
}

/**
 * Location strings Greenhouse ingestion has actually been seen to carry that
 * are NOT a place — a template artefact left in a company's own posting
 * ("City, Country", "Program Country"), an internal-org label ("OpCo"), or a
 * genuinely blank/placeholder value. Greenhouse's `location.name` is free
 * text set per-posting by each hiring company (unlike schema.org's
 * structured address in schema-org.ts), so unlike that source this needs an
 * explicit denylist rather than a structural check. Checked against every
 * `work_type IS NULL` location value in production on 2026-09-05 — anything
 * not on this list read as a real, specific place (a city, a region, a
 * country, or several of those joined with ";").
 */
const NON_LOCATION_VALUES = new Set([
  "",
  "-",
  "n/a",
  "na",
  "tbd",
  "unknown",
  "unspecified",
  "none",
  "various",
  "multiple locations",
  "worldwide",
  "global",
  "opco",
  "program country",
  "city, country",
]);

function namesARealPlace(location: string | undefined): boolean {
  const normalized = location?.trim().toLowerCase() ?? "";
  return normalized.length > 0 && !NON_LOCATION_VALUES.has(normalized);
}

export function inferWorkType(title: string, location: string | undefined): WorkType | undefined {
  const text = `${title} ${location ?? ""}`.toLowerCase();
  if (text.includes("remote")) return "remote";
  if (text.includes("hybrid")) return "hybrid";
  /**
   * Neither signal fired. A location that names a real, specific place is
   * treated as positive evidence the role is on-site there — it is NOT a
   * default for "couldn't tell": a missing, empty, or templated location
   * (see NON_LOCATION_VALUES) still returns undefined, exactly as before
   * this branch existed. The asymmetry with `inferSeniority` below — which
   * DOES default when it runs out of signal — is deliberate here, not an
   * oversight: a wrong seniority guess is a cosmetic badge, but a wrong
   * onsite guess would tell a candidate an aggregation failure was a
   * confident fact about where the job is.
   */
  return namesARealPlace(location) ? "onsite" : undefined;
}

export function inferSeniority(title: string): SeniorityLevel | undefined {
  const text = title.toLowerCase();
  if (/\b(chief|vp|vice president|executive|director)\b/.test(text)) return "executive";
  if (/\b(lead|principal|staff|head of)\b/.test(text)) return "lead";
  if (/\b(senior|sr\.?)\b/.test(text)) return "senior";
  if (/\b(intern|internship|graduate|entry)\b/.test(text)) return "entry";
  if (/\b(junior|jr\.?)\b/.test(text)) return "entry";
  return "mid";
}
