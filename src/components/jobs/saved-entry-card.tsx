import Link from "next/link";
import { BorderedCard } from "@/components/ui";
import { toggleSaveAction } from "@/lib/applications/actions";
import { getCompanyInitials } from "@/lib/jobs/company-initials";
import type { SavedEntry } from "@/lib/jobs/saved-set";

/**
 * A saved job that is not an open posting, on the feed's Saved tab (send-496).
 *
 * Two kinds, both rendered from data the tracker already holds:
 *  - "closed": the posting closed or was removed. It says so, and it is NEVER offered Apply, Auto-Apply, Ask Farah or a
 *    match score: there is nothing left to apply to. It can be removed, and links to the original listing when there is
 *    one.
 *  - "manual": a job the user added to the tracker themselves. It points back at the tracker, where it is managed.
 *
 * Deliberately not JobCard: that card is built around an open posting (score, Apply, Ask Farah, Report, applicant
 * count), and bending it to also be a closed or snapshot-only card would mean a flag on every one of those.
 */
export function SavedEntryCard({ entry }: { entry: SavedEntry }) {
  const meta = [entry.companyName, entry.location].filter(Boolean).join(" · ");
  // A snapshot's url is whatever was stored: only ever link out to a real web address.
  const href = entry.url && /^https?:\/\//i.test(entry.url) ? entry.url : null;

  return (
    <BorderedCard data-testid="saved-entry-card" className="flex flex-col gap-3 p-5">
      <div className="flex items-start gap-4">
        <div
          aria-hidden="true"
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center bg-ink font-display text-[15px] font-bold text-paper"
        >
          {getCompanyInitials(entry.companyName || entry.title)}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="min-w-0 text-[17px]">{entry.title}</h3>
          {meta && <p className="mt-0.5 text-[13.5px] text-ink-soft">{meta}</p>}
          <p className="mt-2 text-[13px] font-semibold text-ink-soft">
            {entry.kind === "closed" ? "This role has closed" : "Added by you"}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {entry.kind === "closed" && entry.jobPostingId && (
          <form action={toggleSaveAction.bind(null, entry.jobPostingId)}>
            <button
              type="submit"
              className="inline-flex min-h-10 min-w-10 items-center font-body text-[13px] font-semibold text-ink underline underline-offset-2 hover:text-rust"
            >
              Remove
            </button>
          </form>
        )}
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-10 items-center font-body text-[13px] font-semibold text-ink-soft underline underline-offset-2 hover:text-rust"
          >
            View the original listing
          </a>
        )}
        {entry.kind === "manual" && (
          <Link
            href="/tracker?stage=saved"
            className="inline-flex min-h-10 items-center font-body text-[13px] font-semibold text-ink-soft underline underline-offset-2 hover:text-rust"
          >
            Open in tracker
          </Link>
        )}
      </div>
    </BorderedCard>
  );
}
