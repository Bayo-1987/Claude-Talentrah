import Link from "next/link";
import { BorderedCard } from "@/components/ui";
import { getCompanyInitials } from "@/lib/jobs/company-initials";
import { StageSelect } from "@/components/tracker/stage-select";
import { NotesForm } from "@/components/tracker/notes-form";
import { formatTrackerDate as formatDate } from "@/lib/tracker/format-date";

const STAGE_LABEL: Record<string, string> = {
  saved: "Saved",
  applied: "Applied",
  interviewing: "Interviewing",
  offer: "Offer",
  hired: "Hired",
  rejected: "Rejected",
  archived: "Archived",
};

export interface TrackerEntry {
  id: string;
  stage: string;
  appliedAt: string | null;
  notes: string | null;
  /**
   * `applications.updated_at`. Nothing wrote to it before the notes editor
   * did, so rows last touched earlier carry their creation time — the "Edited"
   * line is therefore only meaningful once a note has been saved through the
   * new action, which is also the only case that renders it.
   */
  updatedAt: string | null;
  companyName: string;
  title: string;
  location: string | null;
  url: string | null;
  isManual: boolean;
  resumeId: string | null;
  coverLetterId: string | null;
  /**
   * The title held in `applications.resume_snapshot`, set only when
   * `resumeId` is null because the source resume has been deleted (0094).
   *
   * An application's record of what was sent is not disposable, so deleting a
   * resume nulls the FK and freezes a copy on the application instead. Without
   * this the card would just stop rendering "Resume used" and the history
   * would quietly be gone — a snapshot nobody reads is not a fix.
   */
  resumeSnapshotTitle: string | null;
  coverLetterSnapshotTitle: string | null;
  history: { stage: string; changedAt: string }[];
}

export function TrackerCard({ entry }: { entry: TrackerEntry }) {
  return (
    <BorderedCard className="flex flex-col gap-3.5 p-5">
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center bg-ink font-display text-[15px] font-bold text-paper">
          {getCompanyInitials(entry.companyName)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
            <h3 className="text-[17px]">
              {entry.title}
              {entry.isManual && (
                <span className="ml-2 border border-line px-2 py-0.5 font-display text-[10.5px] font-bold italic text-ink-soft">
                  added manually
                </span>
              )}
            </h3>
            <StageSelect applicationId={entry.id} stage={entry.stage} jobTitle={entry.title} />
          </div>
          <div className="mt-0.5 text-[13px] text-ink-soft">
            {[entry.companyName, entry.location].filter(Boolean).join(" · ")}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-3 text-[12.5px] text-ink-soft">
        {entry.appliedAt && <span>Applied {formatDate(entry.appliedAt)}</span>}
        {entry.url && (
          <a href={entry.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-rust">
            Job posting
          </a>
        )}
        {/*
          Live resume first, snapshot second. The live row is the better
          answer whenever it exists — it opens in the editor and it is what
          the user would want to reuse. The snapshot only stands in once the
          resume is gone, and it says so, because "Resume used" pointing at a
          frozen copy without admitting it would be a quieter lie than showing
          nothing.
        */}
        {entry.resumeId ? (
          <Link
            href={`/resume-builder/edit?resumeId=${entry.resumeId}`}
            className="underline underline-offset-2 hover:text-rust"
          >
            Resume used
          </Link>
        ) : (
          entry.resumeSnapshotTitle && (
            <Link
              href={`/tracker/${entry.id}/sent?doc=resume`}
              data-testid="tracker-resume-snapshot"
              className="underline underline-offset-2 hover:text-rust"
            >
              Resume used (deleted — copy kept)
            </Link>
          )
        )}
        {entry.coverLetterId ? (
          <Link
            href={`/resume-builder/edit?resumeId=${entry.coverLetterId}`}
            className="underline underline-offset-2 hover:text-rust"
          >
            Cover letter used
          </Link>
        ) : (
          entry.coverLetterSnapshotTitle && (
            <Link
              href={`/tracker/${entry.id}/sent?doc=cover-letter`}
              data-testid="tracker-cover-letter-snapshot"
              className="underline underline-offset-2 hover:text-rust"
            >
              Cover letter used (deleted — copy kept)
            </Link>
          )
        )}
      </div>

      {entry.history.length > 1 && (
        <p className="text-[12px] italic text-ink-soft">
          {entry.history
            .map((h) => `${STAGE_LABEL[h.stage] ?? h.stage} (${formatDate(h.changedAt)})`)
            .join(" → ")}
        </p>
      )}

      <NotesForm applicationId={entry.id} notes={entry.notes} updatedAt={entry.updatedAt} />
    </BorderedCard>
  );
}
