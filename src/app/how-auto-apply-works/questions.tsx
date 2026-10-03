import type { ReactNode } from "react";
import {
  AUTO_APPLY_DAILY_SUBMIT_CAP,
  AUTO_APPLY_FREE_PER_WEEK,
  AUTO_APPLY_MAX_PENDING,
  AUTO_APPLY_MIN_SCORE,
} from "@/lib/auto-apply/config";

/**
 * The /how-auto-apply-works questions, built from src/lib/auto-apply/config.ts (S1-26 item 2). This page used to describe the limits
 * only qualitatively so it could not go stale; the numbers are now rendered from the enforced constants instead, so it can state
 * them and still cannot drift. A function, not a module-level constant, so a test can render it with the constants replaced.
 */
export function buildQuestions(): { q: string; a: ReactNode }[] {
  return [
  {
    q: "What does Auto-Apply actually do?",
    a: (
      <>
        Turn it on from your job feed, and Auto-Apply watches for postings that
        score <strong>Excellent</strong> ({AUTO_APPLY_MIN_SCORE}% or higher) against your resume —
        Talentrah&apos;s highest match tier — and adds each one to a review queue. Nothing is
        submitted the moment it&apos;s queued; it just waits there for you.
      </>
    ),
  },
  {
    q: "Does it ever apply without asking me first?",
    a: "No. There's no silent mode, and no setting that creates one. Every match sits in your queue until you personally confirm it — the toggle turns matching on, not submitting.",
  },
  {
    q: "What happens when I confirm a match?",
    a: (
      <>
        It depends on where the job lives. For a job posted directly on
        Talentrah, confirming genuinely submits your application — Talentrah
        owns that posting, so a real application is created and lands in your
        Job Tracker as applied. For a job Talentrah found elsewhere (an
        aggregated, external listing), there&apos;s no way to submit into that
        employer&apos;s own system — confirming opens the original posting for
        you to apply on their site, and saves it to your Job Tracker so you
        don&apos;t lose track of it. It&apos;s never marked as applied on your
        behalf, because nothing was actually submitted — you were only handed
        the link.
      </>
    ),
  },
  {
    q: "Could it submit to a job whose match score has changed since it was queued?",
    a: "No — the match is checked again at the moment you confirm, not just when it first joined the queue. If a score has slipped, or the posting has closed in the meantime, confirming won't submit it.",
  },
  {
    q: "What stops it from submitting to everything?",
    a: `Two limits, both enforced automatically and not adjustable from the toggle: it will submit at most ${AUTO_APPLY_DAILY_SUBMIT_CAP} applications in any rolling 24 hours, and at most ${AUTO_APPLY_MAX_PENDING} matches can sit in the queue waiting for your review. Once the queue is full, Auto-Apply stops adding new matches until you clear some out.`,
  },
  {
    q: "Does it cost anything?",
    a: `Confirming a match on a Talentrah-hosted posting draws from a free weekly allowance of ${AUTO_APPLY_FREE_PER_WEEK} confirmed applications; once that's used up, each one costs credits, the same way Talentrah's other AI actions do. Opening an external posting Auto-Apply found for you is always free and never counted against any cap — Talentrah isn't the one submitting it.`,
  },
  {
    q: "Can I see what it's done?",
    a: "Yes — every match Auto-Apply queues, submits, hands off, or skips shows up in your Auto-Apply queue, with what happened and when. Nothing happens off the record.",
  },
  ];
}
