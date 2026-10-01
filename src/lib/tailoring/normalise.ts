import { achievementsFromTypedList, splitAchievements } from "@/lib/resume/achievements";
import type { ResumeExperienceEntry, StructuredResume } from "@/lib/resume/types";

/**
 * Tailoring-time normalisation: what a freshly tailored resume gets so it
 * reads as one consistent document — dates as "Sep 2022", near-identical
 * skills collapsed to one, casing fixed on a short list of known terms, and
 * one achievement per bullet.
 *
 * Pure functions, applied ONCE, to the model's output at the end of
 * `tailorResumeToJob`. Deliberately not applied on every render and not run as
 * a migration: a resume the user typed themselves is theirs until they tailor
 * it, and "fixing" stored data nobody asked to change is how a candidate's own
 * wording gets rewritten behind their back. Every function here is idempotent.
 */

// ── Dates ───────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

const MONTH_ABBREVIATIONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const STILL_IN_ROLE = new Set(["present", "current", "currently", "now", "ongoing", "to date", "till date"]);

/** 1-12 for "sep", "sept", "september" (any case); undefined for anything else, including "summer". */
function monthNumber(token: string): number | undefined {
  const t = token.toLowerCase();
  if (t.length < 3) return undefined;
  const index = MONTH_NAMES.findIndex((name) => name.startsWith(t));
  return index === -1 ? undefined : index + 1;
}

function formatMonthYear(month: number, year: number): string {
  return `${MONTH_ABBREVIATIONS[month - 1]} ${year}`;
}

/** "22" -> 2022, "85" -> 1985. Only ever called for a two-digit year that follows a month name. */
function expandTwoDigitYear(year: number): number {
  return year < 70 ? 2000 + year : 1900 + year;
}

/**
 * "September 2022", "Sept. 2022", "09/2022", "2022-09", "2022-09-15" and
 * "15 September 2022" all become "Sep 2022"; a bare year stays a year; "now",
 * "current", "ongoing" become "Present". Anything not read confidently — a
 * season, a quarter, "03/04/2022" (day/month order is unknowable) — comes back
 * unchanged rather than guessed at.
 */
export function normaliseDate(raw: string): string;
export function normaliseDate(raw: string | undefined): string | undefined;
export function normaliseDate(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "") return "";

  if (STILL_IN_ROLE.has(trimmed.toLowerCase())) return "Present";
  if (/^\d{4}$/.test(trimmed)) return trimmed;

  const tokens = trimmed.split(/[\s,\-/.]+/).filter((t) => t.length > 0);

  // Month name + year, with an optional day on either side: "Sept. 2022",
  // "September 15, 2022", "15th Sep 2022", "Sep 22".
  const words = tokens.filter((t) => /^[a-z]+$/i.test(t));
  const numbers = tokens.filter((t) => /^\d{1,4}(?:st|nd|rd|th)?$/i.test(t));
  if (words.length === 1 && words.length + numbers.length === tokens.length && numbers.length >= 1 && numbers.length <= 2) {
    const month = monthNumber(words[0]);
    if (month !== undefined) {
      const plain = numbers.map((n) => n.replace(/(?:st|nd|rd|th)$/i, ""));
      const fourDigit = plain.filter((n) => n.length === 4);
      if (fourDigit.length === 1) return formatMonthYear(month, Number(fourDigit[0]));
      // No four-digit year: a lone two-digit number after the month is the year ("Sep 22").
      if (fourDigit.length === 0 && plain.length === 1 && plain[0].length === 2) {
        return formatMonthYear(month, expandTwoDigitYear(Number(plain[0])));
      }
    }
  }

  // Numeric month and year: "09/2022", "9-2022", "2022-09", "2022/9", ISO "2022-09-15".
  if (tokens.length >= 2 && tokens.length <= 3 && tokens.every((t) => /^\d+$/.test(t))) {
    const isMonth = (t: string) => t.length <= 2 && Number(t) >= 1 && Number(t) <= 12;
    if (tokens.length === 2) {
      const [a, b] = tokens;
      if (isMonth(a) && b.length === 4) return formatMonthYear(Number(a), Number(b));
      if (a.length === 4 && isMonth(b)) return formatMonthYear(Number(b), Number(a));
    } else if (tokens[0].length === 4 && isMonth(tokens[1]) && tokens[2].length <= 2) {
      return formatMonthYear(Number(tokens[1]), Number(tokens[0]));
    }
  }

  return trimmed;
}

type Dated = { startDate?: string; endDate?: string };

function normaliseDatePair<T extends Dated>(entry: T): T {
  const next = { ...entry };
  if (entry.startDate !== undefined) next.startDate = normaliseDate(entry.startDate);
  if (entry.endDate !== undefined) next.endDate = normaliseDate(entry.endDate);
  return next;
}

/** Start and end dates of experience and education — the two sections the tailoring model returns. Free text is never touched. */
export function normaliseTailoredDates(resume: StructuredResume): StructuredResume {
  return {
    ...resume,
    experience: resume.experience.map(normaliseDatePair),
    education: resume.education.map(normaliseDatePair),
  };
}

// ── Skills ──────────────────────────────────────────────────────────────────

/**
 * Terms whose casing is fixed to the form on the right. Small and explicit on
 * purpose: this is not a dictionary, and any term not listed is left exactly as
 * the candidate wrote it. Matching ignores case, hyphens and underscores, so
 * "project-management" and "project Management" both land on "Project
 * Management".
 */
export const KNOWN_SKILL_TERMS: readonly string[] = [
  // Practices
  "Project Management",
  "Product Management",
  "Program Management",
  "Stakeholder Management",
  "Change Management",
  "Data Analysis",
  "Data Analytics",
  "Data Visualization",
  "Customer Success",
  "Business Development",
  "Product-Led Growth",
  "Product-Led",
  // Acronyms
  "SQL",
  "API",
  "APIs",
  "SEO",
  "CRM",
  "KPI",
  "KPIs",
  "OKR",
  "OKRs",
  "ETL",
  "UX",
  "UI",
  "AWS",
  "HTML",
  "CSS",
  "SaaS",
  "B2B",
  "B2C",
  // Brands
  "JavaScript",
  "TypeScript",
  "Node.js",
  "Next.js",
  "PostgreSQL",
  "GitHub",
];

/** Case-, hyphen- and underscore-insensitive comparison key: "Project-Management" -> "project management". */
function skillKey(skill: string): string {
  return skill.toLowerCase().replace(/[\s_-]+/g, " ").trim();
}

const KNOWN_BY_KEY = new Map(KNOWN_SKILL_TERMS.map((term) => [skillKey(term), term]));

/**
 * Collapses near-identical skills ("Project Management" / "project
 * management" / "Project-Management") to one entry at the position of the
 * first, and fixes the casing of known terms.
 *
 * Which spelling survives: a known term's own spelling; otherwise the first
 * variant that has any capital letter (someone capitalised it on purpose),
 * else the first variant. Different skills that merely look alike — Java and
 * JavaScript, C and C++ — have different keys and are kept apart.
 */
export function normaliseSkills(skills: readonly string[]): string[] {
  const groups = new Map<string, string[]>();
  for (const raw of skills) {
    const spelled = raw.replace(/\s+/g, " ").trim();
    if (spelled === "") continue;
    const key = skillKey(spelled);
    const group = groups.get(key);
    if (group) group.push(spelled);
    else groups.set(key, [spelled]);
  }
  return [...groups.entries()].map(([key, variants]) => {
    const known = KNOWN_BY_KEY.get(key);
    if (known) return known;
    return variants.find((v) => /[A-Z]/.test(v)) ?? variants[0];
  });
}

/** True when two skill strings are the same skill under `normaliseSkills`' comparison. */
export function isSameSkill(a: string, b: string): boolean {
  return skillKey(a) === skillKey(b);
}

// ── Achievements ────────────────────────────────────────────────────────────

/**
 * One achievement per bullet. Bullets the model returned are split wherever
 * several were glued into one string or carry their own markers; a
 * `description` that is really a typed list becomes bullets. A description
 * that is prose stays prose — no one-item bullet list is invented.
 *
 * `description` keeps a plain-text fallback (the bullets joined with a space,
 * the same convention the editor uses) when it was the source of the bullets or
 * was empty; a prose description the model wrote alongside real bullets is left
 * as it is.
 */
export function normaliseExperienceAchievements(entry: ResumeExperienceEntry): ResumeExperienceEntry {
  const fromBullets = (entry.bullets ?? []).flatMap((bullet) => splitAchievements(bullet));
  if (fromBullets.length > 0) {
    const description = entry.description?.trim() ? entry.description : plainTextFallback(fromBullets, entry.description);
    return { ...entry, bullets: fromBullets, description };
  }

  // Strict on purpose (achievements.ts): two plain lines are two paragraphs of
  // prose, not a list; only a description whose lines all carry markers is one.
  const fromDescription = achievementsFromTypedList(entry.description);
  if (fromDescription) {
    return { ...entry, bullets: fromDescription, description: plainTextFallback(fromDescription, entry.description) };
  }

  return entry;
}

/**
 * The longest `description` the sanitizer keeps (resume/sanitize.ts
 * LONG_FIELD_MAX): past it, the text is truncated and the whole response is
 * judged degenerate and re-requested from the model. A role with many long
 * bullets must not trip that just by having its fallback text assembled.
 */
const DESCRIPTION_MAX_CHARS = 2000;

/** The bullets joined with a space (the editor's own fallback convention), or `otherwise` if that would be too long to keep. */
function plainTextFallback(bullets: string[], otherwise: string | undefined): string | undefined {
  const joined = bullets.join(" ");
  return joined.length <= DESCRIPTION_MAX_CHARS ? joined : otherwise;
}

export function normaliseTailoredAchievements(resume: StructuredResume): StructuredResume {
  return { ...resume, experience: resume.experience.map(normaliseExperienceAchievements) };
}

// ── The whole pass ──────────────────────────────────────────────────────────

/** Everything above, in one idempotent pass over a freshly tailored resume. */
export function normaliseTailoredResume(resume: StructuredResume): StructuredResume {
  const dated = normaliseTailoredDates(normaliseTailoredAchievements(resume));
  return { ...dated, skills: normaliseSkills(dated.skills) };
}
