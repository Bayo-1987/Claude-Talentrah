import Link from "next/link";
import { EyebrowLabel, buttonClasses } from "@/components/ui";

/**
 * The Jobs Posted page header: the title block on the left and "Post a job" on the right, sharing one top edge. Nothing else lives here (the email preference has its own row below), so the header's height
 * never depends on a control that changes. Stacked on narrow screens: title, then the button.
 */
export function JobsPostedHeader({ organizationName, summary }: { organizationName: string; summary: string }) {
  return (
    <div data-testid="jobs-posted-header" className="flex flex-col items-start gap-4 sm:flex-row sm:justify-between">
      <div data-testid="jobs-posted-title-block" className="min-w-0">
        <EyebrowLabel>{organizationName}</EyebrowLabel>
        <h1 className="mt-2 font-display text-[30px] leading-[1.15] font-medium text-ink">Jobs Posted</h1>
        <p className="mt-1.5 font-body text-[14px] text-ink-soft">{summary}</p>
      </div>
      <Link href="/employer/jobs/new" className={buttonClasses("primary", "md", "no-underline shrink-0")}>
        Post a job
      </Link>
    </div>
  );
}
