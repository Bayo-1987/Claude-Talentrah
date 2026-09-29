import { describeMatchConfidence } from "@/lib/match-tier";

/**
 * Which of a user's Auto-Apply queue entries make this week's proof-of-work
 * digest — send-463.
 *
 * ── ANCHORED ON queuedAt, NOT decidedAt ─────────────────────────────────────
 *
 * "Farah queued 4 applications for your review this week, you approved 3" is
 * the shape of the report: the anchor event is the QUEUEING, and the counts
 * are a breakdown of what those same entries' status happens to be as of
 * send time — including still-`pending` ones, which never show up as a named
 * bucket but are exactly why `queued` can exceed
 * submitted+handedOff+dismissed+expired. An entry queued last week and only
 * decided this week is reported in LAST week's email, not this one — the
 * event this digest exists to surface is Farah acting, not the user's own
 * review cadence.
 *
 * ── WHY THIS IS NOT selectDigestJobs' "SILENCE BELOW A MINIMUM" RULE ────────
 *
 * The match digest (src/lib/digest/select.ts) skips a week below MIN_JOBS
 * because a thin list reads as the product not having much to say. This is a
 * different kind of email: it is a report of what an automated feature did
 * on the user's behalf, not a ranked recommendation list. A week where Farah
 * queued exactly one application is still a fact worth reporting — the
 * silence rule here is narrower and absolute: stay silent ONLY when nothing
 * happened at all (queued === 0, and therefore every other bucket is 0 too).
 *
 * ── THE TIER LABEL IS COMPUTED HERE, THROUGH describeMatchConfidence,
 * NEVER HAND-BUILT ──────────────────────────────────────────────────────────
 *
 * docs/match-confidence-invariant.md's standing rule, enforced repo-wide by
 * tests/lib/match-confidence-enforcement.test.ts's own file scan — this
 * module calls the shared function directly rather than printing
 * `${score}%` or looking up MATCH_TIER_LABEL itself, so that scan covers it
 * automatically. In practice every Auto-Apply queue entry already cleared
 * the Excellent-only gate (0164) before being queued at all, so `label`
 * should never come back null here — asserted with a throw, the same
 * discipline digest/template.ts's own confidenceLabel() uses, rather than a
 * silent fallback that would hide a real invariant break.
 */

export interface AutoApplyQueueEntryLike {
  status: "pending" | "submitted" | "handed_off" | "dismissed" | "expired";
  /** ISO timestamp — `auto_apply_queue.queued_at`. */
  queuedAt: string;
  jobTitle: string;
  companyName: string;
  score: number;
  /** Same `match_scores.explanation` shape describeMatchConfidence already accepts elsewhere — untyped Json, tolerant of missing/malformed data. */
  explanation: unknown;
}

export interface AutoApplyDigestHighlight {
  jobTitle: string;
  companyName: string;
  /** Always describeMatchConfidence's own label — never a hand-built string. */
  tier: string;
}

export interface AutoApplyDigestSummary {
  queued: number;
  submitted: number;
  handedOff: number;
  dismissed: number;
  expired: number;
  highlights: AutoApplyDigestHighlight[];
}

/** Mirrors digest/select.ts's own MAX_JOBS — beyond this a list becomes noise, not proof. */
export const MAX_HIGHLIGHTS = 3;

function inWindow(entry: AutoApplyQueueEntryLike, windowStart: Date, windowEnd: Date): boolean {
  const t = new Date(entry.queuedAt).getTime();
  return t >= windowStart.getTime() && t < windowEnd.getTime();
}

export function selectAutoApplyDigestSummary(
  entries: AutoApplyQueueEntryLike[],
  windowStart: Date,
  windowEnd: Date,
): AutoApplyDigestSummary | null {
  const weekly = entries.filter((e) => inWindow(e, windowStart, windowEnd));

  const queued = weekly.length;
  const submitted = weekly.filter((e) => e.status === "submitted").length;
  const handedOff = weekly.filter((e) => e.status === "handed_off").length;
  const dismissed = weekly.filter((e) => e.status === "dismissed").length;
  const expired = weekly.filter((e) => e.status === "expired").length;

  if (queued + submitted + handedOff + dismissed + expired === 0) {
    // Genuinely nothing happened this week — stay silent rather than
    // sending an email that says so.
    return null;
  }

  const highlightCandidates = weekly
    .filter((e) => e.status === "submitted" || e.status === "handed_off")
    // Most recent activity first — the freshest proof of work is the most
    // convincing one to lead with.
    .sort((a, b) => new Date(b.queuedAt).getTime() - new Date(a.queuedAt).getTime())
    .slice(0, MAX_HIGHLIGHTS);

  const highlights: AutoApplyDigestHighlight[] = highlightCandidates.map((e) => {
    const { label } = describeMatchConfidence(e.score, e.explanation);
    if (label === null) {
      throw new Error(
        `selectAutoApplyDigestSummary: queue entry for "${e.jobTitle}" scored ${e.score} with no confidence label — ` +
          `every Auto-Apply queue entry should already have cleared the Excellent-only gate before being queued.`,
      );
    }
    return { jobTitle: e.jobTitle, companyName: e.companyName, tier: label };
  });

  return { queued, submitted, handedOff, dismissed, expired, highlights };
}
