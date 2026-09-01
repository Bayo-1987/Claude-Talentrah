import "server-only";
import { computeScholarshipFingerprint } from "./dedup";
import { extractDeadlineCandidates } from "./deadline-extract";
import type { NormalizedScholarship } from "./types";

/**
 * The founder's 2026-09-01 requirement, made mechanical: "a scheduled check on
 * each of these sites daily to confirm if a scholarship closed — don't show
 * closed scholarships."
 *
 * Half of that already existed: markExpiredCycles unpublishes anything whose
 * stored deadline has passed, every daily run. What it could not catch is a
 * provider MOVING a deadline (earlier is the dangerous direction) or a page
 * whose date we verified going stale. This pass re-reads the official page for
 * each listing that has a recheck target and compares.
 *
 * WHAT IT WILL AND WILL NOT DO:
 *
 *  - Page shows exactly one plausible future deadline, SAME as ours → the
 *    listing passes through untouched. NOT re-stamped: rewriting
 *    deadline_verified_at daily would make a content column churn on every
 *    run and park the whole verified catalog in the review queue — the same
 *    trap the TIMESTAMP_COLUMNS comment in ingest.ts records. Freshness is
 *    already recorded per-pass in last_checked_at.
 *  - Page shows exactly one plausible future deadline, DIFFERENT from ours →
 *    the listing is updated with the new date, stamped machine-verified, and
 *    the existing upsert rule does the rest: a published listing whose content
 *    moved goes back to a human. Auto-publish never applies to a change.
 *  - Zero candidates, several candidates, fetch failure, non-200 → the
 *    curated data stands untouched and the run's summary says so. A site
 *    being down for a day must not degrade a verified listing, and ambiguity
 *    is a human's job — both halves of §6.15's "wrong deadline is the worst
 *    error" rule.
 *
 * Targets are limited to sources whose robots.txt permits fetching (checked
 * per-source, evidence in docs/scholarship-sources.md) and are fetched once
 * per daily run — comfortably inside even Stanford's requested 30s
 * crawl-delay.
 */

export interface RecheckTarget {
  provider: string;
  programName: string;
  cycleYear: number;
  /** The page actually carrying the deadline — not always the listing's officialUrl. */
  url: string;
}

export const RECHECK_TARGETS: RecheckTarget[] = [
  {
    provider: "UK Foreign, Commonwealth & Development Office",
    programName: "Chevening Scholarships",
    cycleYear: 2027,
    url: "https://www.chevening.org/apply/",
  },
  {
    provider: "Gates Cambridge Trust",
    programName: "Gates Cambridge Scholarship",
    cycleYear: 2027,
    url: "https://www.gatescambridge.org/apply/timeline/",
  },
  {
    provider: "Stanford University",
    programName: "Knight-Hennessy Scholars",
    cycleYear: 2027,
    url: "https://knight-hennessy.stanford.edu/admission",
  },
  {
    provider: "Commonwealth Scholarship Commission (UK)",
    programName: "Commonwealth Master's Scholarships",
    cycleYear: 2027,
    url: "https://cscuk.fcdo.gov.uk/scholarships/commonwealth-masters-scholarships/",
  },
];

export interface RecheckOutcome {
  listings: NormalizedScholarship[];
  /** One line per target that could not be confirmed — surfaced, not failed. */
  notices: string[];
}

const FETCH_TIMEOUT_MS = 10_000;

async function fetchPage(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Identify honestly. A crawler pretending to be a browser forfeits the
        // "our robots.txt evidence covers this" claim the docs make.
        "user-agent": "TalentrahScholarshipCheck/1.0 (+https://claude-talentrah.vercel.app)",
        accept: "text/html",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Re-verify deadlines for every listing that has a recheck target. Never
 * throws: a recheck can only improve a listing or leave it alone.
 */
export async function recheckDeadlines(
  listings: NormalizedScholarship[],
  today: string = new Date().toISOString().slice(0, 10),
): Promise<RecheckOutcome> {
  const byFingerprint = new Map(
    listings.map((listing) => [
      computeScholarshipFingerprint(listing.provider, listing.programName, listing.cycleYear),
      listing,
    ]),
  );
  const notices: string[] = [];

  for (const target of RECHECK_TARGETS) {
    const fingerprint = computeScholarshipFingerprint(
      target.provider,
      target.programName,
      target.cycleYear,
    );
    const listing = byFingerprint.get(fingerprint);
    if (!listing) {
      notices.push(`recheck: no curated listing matches ${target.programName} ${target.cycleYear}`);
      continue;
    }

    let candidates: string[];
    try {
      candidates = extractDeadlineCandidates(await fetchPage(target.url), today);
    } catch (err) {
      notices.push(
        `recheck: ${target.programName} fetch failed (${err instanceof Error ? err.message : "unknown"}) — curated data left as-is`,
      );
      continue;
    }

    if (candidates.length !== 1) {
      notices.push(
        `recheck: ${target.programName} page had ${candidates.length} candidate dates — needs a human, curated data left as-is`,
      );
      continue;
    }

    const [pageDeadline] = candidates;
    if (pageDeadline === listing.applicationDeadline) continue;

    byFingerprint.set(fingerprint, {
      ...listing,
      applicationDeadline: pageDeadline,
      deadlineVerifiedAt: new Date().toISOString(),
      reviewNote: `Deadline recheck ${today}: official page now shows ${pageDeadline} (was ${listing.applicationDeadline ?? "unset"}). ${listing.reviewNote ?? ""}`.trim(),
    });
    notices.push(
      `recheck: ${target.programName} deadline moved ${listing.applicationDeadline ?? "unset"} → ${pageDeadline}`,
    );
  }

  return { listings: Array.from(byFingerprint.values()), notices };
}
