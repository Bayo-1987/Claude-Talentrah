import type { MatchTier } from "@/lib/match-tier";
import { getMatchTier } from "@/lib/match-tier";

/**
 * Which jobs go in one person's weekly digest.
 *
 * ── WEEKLY, AND THE DATA SAYS SO ──────────────────────────────────────────
 *
 * Measured against production before choosing, not assumed: over the last 30
 * days the board took 107 new postings — a mean of 3.6 a day, and SEVEN of
 * those 30 days took none at all. Nearly one day in four has nothing new to
 * say before per-user match filtering runs, and after filtering to one
 * person's Excellent/Good matches most days would be empty for most people.
 *
 * A daily digest would therefore be mostly silence punctuated by one or two
 * jobs, which trains people to ignore it — and the cost of that is not neutral,
 * it is the channel. Weekly gathers ~24 postings, enough that a person with a
 * reasonable resume has something worth opening.
 *
 * ── WHAT IS DELIBERATELY EXCLUDED ─────────────────────────────────────────
 *
 * FAIR MATCHES. The digest is a reason to come back, not a list of everything.
 * A Fair match is "you could apply"; it does not justify an email. The feed is
 * where someone browses the long tail — an email has to earn its place in an
 * inbox on the strength of its best item.
 *
 * ANYTHING ALREADY ACTED ON. A job someone saved or applied to is not news to
 * them, and mailing it back reads as the product not knowing what they did.
 *
 * NOTHING IS SENT AT ALL BELOW `MIN_JOBS`. An email that says "here is one
 * mediocre thing" is worse than no email; a week with nothing to report should
 * be a silent week. This is the reason the digest can be honest about its own
 * value — it only arrives when it has something.
 */

/** A job is only digest-worthy if it beats this. `getMatchTier` fixes 70 = Good. */
export const MIN_DIGEST_SCORE = 70;

/** Fewer than this and the week is skipped entirely rather than padded. */
export const MIN_JOBS = 2;

/** Beyond this an email becomes a list nobody reads to the end of. */
export const MAX_JOBS = 5;

/** How far back "new this week" reaches. */
export const DIGEST_WINDOW_DAYS = 7;

export interface DigestCandidate {
  jobId: string;
  title: string;
  companyName: string;
  location: string | null;
  score: number;
  postedAt: string;
  /** True when the person has saved or applied to this posting already. */
  alreadyActedOn: boolean;
}

export interface DigestJob {
  jobId: string;
  title: string;
  companyName: string;
  location: string | null;
  score: number;
  tier: MatchTier;
}

/**
 * Picks the jobs for one person, or returns an empty array meaning "send
 * nothing this week".
 *
 * Pure, and takes the candidate rows rather than a client, because the
 * interesting part is the policy — what counts, what is dropped, when silence
 * is the right answer — and none of that should need a database to test.
 */
export function selectDigestJobs(candidates: DigestCandidate[]): DigestJob[] {
  const eligible = candidates
    .filter((c) => !c.alreadyActedOn)
    .filter((c) => c.score >= MIN_DIGEST_SCORE)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, MAX_JOBS);

  // The whole-week silence rule. Deliberately checked AFTER the cap, not
  // before: capping cannot take a qualifying week below the floor.
  if (eligible.length < MIN_JOBS) return [];

  return eligible.map((c) => ({
    jobId: c.jobId,
    title: c.title,
    companyName: c.companyName,
    location: c.location,
    score: c.score,
    tier: getMatchTier(c.score),
  }));
}
