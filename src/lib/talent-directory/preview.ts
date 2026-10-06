/**
 * The Talent Directory free preview (EMP-1 / E1): the threshold, the exact copy, and the parser between the database's
 * `talent_directory_preview()` payload and the page. Pure: imported by client-safe components and by tests.
 *
 * WHY A THRESHOLD. Measured on production 2026-10-02: one opted-in, verified candidate and no active subscription. Selling a
 * ₦200,000/month subscription against a pool of one is the thing this prevents. Below TALENT_DIRECTORY_MIN_LISTED the page hides
 * Subscribe and offers a waitlist; `purchaseTalentDirectorySubscriptionAction` refuses too, because a hidden button is not a gate.
 *
 * WHY A PARSER. The anonymisation rules live in SQL (migration 0206), because an employer's session can call the RPC directly. This
 * parser is the second line: it copies exactly the five safe fields, so a field added to the RPC later (a name, an id) can never
 * reach a page by accident, and it never trusts a count it cannot read.
 */

/** Verified, opted-in candidates needed before the Subscribe flow is offered. Tested at 9 vs 10. */
export const TALENT_DIRECTORY_MIN_LISTED = 10;

/** The most anonymised sample cards ever shown. The database enforces it too (0206). */
export const TALENT_DIRECTORY_MAX_SAMPLES = 3;

const MAX_SKILLS_PER_SAMPLE = 4;

export const YEARS_BANDS = ["0-2", "3-5", "6-9", "10+"] as const;
export type YearsBand = (typeof YEARS_BANDS)[number];

export interface PreviewSample {
  /** A coarse role family ("Engineering") or "Professional"; never a job title. */
  role: string;
  yearsBand: YearsBand | null;
  skills: string[];
  availableForHire: boolean;
  remoteReady: boolean;
}

export interface TalentDirectoryPreview {
  count: number;
  samples: PreviewSample[];
}

export function isSubscriptionOpen(listedCount: number): boolean {
  return listedCount >= TALENT_DIRECTORY_MIN_LISTED;
}

/** "0 candidates with a reviewed resume", "1 candidate with a reviewed resume", "2 candidates with a reviewed resume": the noun agrees with the number. */
export function candidatesWithReviewedResume(n: number): string {
  return `${n} candidate${n === 1 ? "" : "s"} with a reviewed resume`;
}

/** "is" for exactly one, "are" for everything else (zero included), for "N candidate(s) with a reviewed resume is/are listed". */
export function isAre(n: number): "is" | "are" {
  return n === 1 ? "is" : "are";
}

/**
 * How close the directory is to opening, for the waitlist card: "N of 10 candidates with a reviewed resume listed", as text and as a progress bar. N is clamped to
 * 0..the threshold and truncated to a whole number, so a bad count can never draw a bar fuller than full or emptier than empty.
 */
export function listedProgress(listedCount: number): { now: number; max: number; pct: number; text: string } {
  const whole = Number.isFinite(listedCount) ? Math.trunc(listedCount) : 0;
  const now = Math.min(Math.max(whole, 0), TALENT_DIRECTORY_MIN_LISTED);
  return {
    now,
    max: TALENT_DIRECTORY_MIN_LISTED,
    pct: (now / TALENT_DIRECTORY_MIN_LISTED) * 100,
    text: `${now} of ${TALENT_DIRECTORY_MIN_LISTED} candidates with a reviewed resume listed`,
  };
}

/** What the waitlist costs, said to an organisation that has joined it. A promise: nothing is charged without pricing being shown first. */
export const WAITLIST_FREE_NOTE = "Free while you wait. We'll tell you about pricing before anything is charged.";

/**
 * The founder's wording, with N interpolated, the noun agreeing with N, and the threshold read from the constant. (It said
 * "1 verified candidates" until the count was routed through candidatesWithReviewedResume (then verifiedCandidates); production had exactly one listed candidate.)
 */
export function buildingTheDirectoryMessage(listedCount: number): string {
  return `We're building the directory: ${candidatesWithReviewedResume(listedCount)} so far. Join the waitlist and we'll tell you when ${TALENT_DIRECTORY_MIN_LISTED}+ are listed.`;
}

function parseSample(raw: unknown): PreviewSample | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const yearsBand = (YEARS_BANDS as readonly unknown[]).includes(r.yearsBand) ? (r.yearsBand as YearsBand) : null;
  const skills = Array.isArray(r.skills)
    ? r.skills.filter((s): s is string => typeof s === "string").slice(0, MAX_SKILLS_PER_SAMPLE)
    : [];
  return {
    role: typeof r.role === "string" && r.role.trim() ? r.role : "Professional",
    yearsBand,
    skills,
    availableForHire: r.availableForHire === true,
    remoteReady: r.remoteReady === true,
  };
}

export function parseTalentDirectoryPreview(raw: unknown): TalentDirectoryPreview {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("talent_directory_preview returned no payload");
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.count !== "number" || !Number.isInteger(r.count) || r.count < 0) {
    throw new Error("talent_directory_preview returned no usable count");
  }
  const samples = (Array.isArray(r.samples) ? r.samples : [])
    .map(parseSample)
    .filter((s): s is PreviewSample => s !== null)
    .slice(0, TALENT_DIRECTORY_MAX_SAMPLES);
  return { count: r.count, samples };
}
