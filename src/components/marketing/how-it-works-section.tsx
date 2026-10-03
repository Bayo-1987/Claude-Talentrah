import { EyebrowLabel } from "@/components/ui";
import { AUTO_APPLY_FREE_PER_WEEK } from "@/lib/auto-apply/config";

/**
 * send-390 — step 4 used to describe the mechanism ("let Farah apply on
 * your behalf with your review") without ever naming Auto-Apply or saying
 * anything about the restraint that's the actual point of it. Per CLAUDE.md's
 * own differentiation thesis, Auto-Apply was deliberately built as a trust
 * feature — conservative threshold, review-gated, server-capped — precisely
 * so it doesn't read like a "blast your resume at every job" tool. The cap
 * free-allowance number is interpolated from AUTO_APPLY_FREE_PER_WEEK (src/lib/auto-apply/
 * config.ts: "5 free confirmed submissions per rolling 7 days") rather than
 * hardcoded, so this copy can't silently drift from the real, enforced value.
 *
 * S1-43: the allowance is NOT a cap. It used to read "capped at 5 free
 * applications a week", which says a hard weekly limit; in the code it is a
 * free line, after which each confirmation uses credits (the daily submission
 * cap, AUTO_APPLY_DAILY_SUBMIT_CAP, is a separate burst limit this one-line
 * step deliberately does not state, and opening an external posting is always
 * free). The copy says what is true: only your best matches, nothing submitted
 * until you confirm, N free a week, then credits. It agrees with
 * /how-auto-apply-works, which says "a free weekly allowance" then credits.
 * Step 1 no longer offers "a job link": nothing in this codebase fetches one.
 *
 * Scoped to what Auto-Apply actually submits, per docs/auto-apply.md: it
 * never submits to external postings (no ATS integration — those are
 * handed off, marked `handed_off`, never `applied`). This copy doesn't
 * claim "any job on the board" for exactly that reason — "your best
 * matches" ties to the existing Excellent/Good/Fair match-tier language
 * already used everywhere else on the site, not a new claim about scope.
 */
/** One sentence of what is free and what is not; "1 confirmed applications" would read as a bug. */
export function autoApplyCopy(freePerWeek: number): string {
  const free = freePerWeek === 1 ? "Your first confirmed application each week is free" : `Your first ${freePerWeek} confirmed applications each week are free`;
  return `Auto-Apply queues only your best matches and submits nothing until you confirm. ${free}; after that, each one uses credits.`;
}

const STEPS = [
  {
    number: "01",
    title: "Paste a job description",
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
    copy: autoApplyCopy(AUTO_APPLY_FREE_PER_WEEK),
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
        {/*
          * Each step spans three rows of the parent grid and takes them as a subgrid, so the four numbers, the four headings and the four
          * paragraphs each share a row: two-line headings (steps 3 and 4) no longer push their paragraphs below steps 1 and 2. In a browser
          * without subgrid the step is an ordinary three-row grid (the old stacked look). `gap-y-3` restores the step's own 12px rhythm
          * inside the subgrid; the parent's 32px gap only separates rows of steps.
          */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-8 min-[901px]:grid-cols-4">
          {STEPS.map((step) => (
            <div key={step.number} className="row-span-3 grid grid-rows-subgrid gap-y-3 border-t border-line pt-4">
              <span className="font-display text-[28px] italic text-rust">{step.number}</span>
              <h3 className="text-balance font-display text-[17px] font-semibold text-ink">{step.title}</h3>
              <p className="text-[14.5px] text-ink-soft">{step.copy}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
