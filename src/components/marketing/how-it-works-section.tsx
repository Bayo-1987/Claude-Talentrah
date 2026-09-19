import { EyebrowLabel } from "@/components/ui";
import { AUTO_APPLY_FREE_PER_WEEK } from "@/lib/auto-apply/config";

/**
 * send-390 — step 4 used to describe the mechanism ("let Farah apply on
 * your behalf with your review") without ever naming Auto-Apply or saying
 * anything about the restraint that's the actual point of it. Per CLAUDE.md's
 * own differentiation thesis, Auto-Apply was deliberately built as a trust
 * feature — conservative threshold, review-gated, server-capped — precisely
 * so it doesn't read like a "blast your resume at every job" tool. The cap
 * number is interpolated from AUTO_APPLY_FREE_PER_WEEK (src/lib/auto-apply/
 * config.ts: "5 free confirmed submissions per rolling 7 days") rather than
 * hardcoded, so this copy can't silently drift from the real, enforced
 * value if that constant ever changes. Deliberately NOT
 * AUTO_APPLY_DAILY_SUBMIT_CAP — same numeric value today (5) but a
 * different constant, a different window (rolling 24h vs. rolling 7 days),
 * and a different purpose (a burst-prevention safety cap, not the free-tier
 * line); citing the wrong one here would still read correctly today and
 * silently mean something else the day either number changes.
 *
 * Scoped to what Auto-Apply actually submits, per docs/auto-apply.md: it
 * never submits to external postings (no ATS integration — those are
 * handed off, marked `handed_off`, never `applied`). This copy doesn't
 * claim "any job on the board" for exactly that reason — "your best
 * matches" ties to the existing Excellent/Good/Fair match-tier language
 * already used everywhere else on the site, not a new claim about scope.
 */
const STEPS = [
  {
    number: "01",
    title: "Paste a job link or description",
    copy: "Talentrah reads the real requirements — not just keywords.",
  },
  {
    number: "02",
    title: "Farah analyzes the gap",
    copy: "See exactly what's matched and what's missing from your resume.",
  },
  {
    number: "03",
    title: "Get a tailored resume + match score",
    copy: "Editable, exportable, ready to send.",
  },
  {
    number: "04",
    title: "Apply — or let Auto-Apply do it",
    copy: `Auto-Apply only submits your best matches, always with your review, capped at ${AUTO_APPLY_FREE_PER_WEEK} free applications a week — never blind, never spam.`,
  },
];

export function HowItWorksSection() {
  return (
    <div id="how-it-works" className="py-24">
      <div className="mx-auto max-w-[1120px] px-10">
        <div className="mb-14 flex max-w-[560px] flex-col gap-4">
          <EyebrowLabel>How it works</EyebrowLabel>
          <h2 className="text-[32px] leading-[1.25]">
            From job posting to tailored application, in four steps.
          </h2>
        </div>
        <div className="grid grid-cols-2 gap-8 min-[901px]:grid-cols-4">
          {STEPS.map((step) => (
            <div key={step.number} className="flex flex-col gap-3 border-t border-line pt-4">
              <span className="font-display text-[28px] italic text-line">{step.number}</span>
              <h3 className="font-display text-[17px] font-semibold text-ink">{step.title}</h3>
              <p className="text-[14.5px] text-ink-soft">{step.copy}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
