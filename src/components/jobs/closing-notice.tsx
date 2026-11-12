import { closingNotice, type ClosingFacts } from "@/lib/jobs/closing-date";

/**
 * "Closes 10 Nov 2026", and a "Closing soon" tag at 7 days or fewer: on the feed card and the job page, from the same rules (src/lib/jobs/closing-date.ts). Renders nothing unless the date was STATED.
 * A separate line from "Posted ... ago", which e2e/feed-chrome.spec.ts pins as one string.
 */
export function ClosingNotice({ job, className = "" }: { job: ClosingFacts; className?: string }) {
  const notice = closingNotice(job);
  if (!notice) return null;
  return (
    <span data-testid="closing-notice" className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-soft ${className}`.trim()}>
      <span>{notice.label}</span>
      {notice.soon && <span className="border border-ink px-1.5 py-px text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink">Closing soon</span>}
    </span>
  );
}
