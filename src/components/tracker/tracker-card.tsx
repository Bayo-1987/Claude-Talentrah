import Link from "next/link";
import { BorderedCard } from "@/components/ui";
import { getCompanyInitials } from "@/lib/jobs/company-initials";
import { StageSelect } from "@/components/tracker/stage-select";
import { NotesForm } from "@/components/tracker/notes-form";

const STAGE_LABEL: Record<string, string> = {
  saved: "Saved",
  applied: "Applied",
  interviewing: "Interviewing",
  offer: "Offer",
  hired: "Hired",
  rejected: "Rejected",
  archived: "Archived",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export interface TrackerEntry {
  id: string;
  stage: string;
  appliedAt: string | null;
  notes: string | null;
  companyName: string;
  title: string;
  location: string | null;
  url: string | null;
  isManual: boolean;
  resumeId: string | null;
  coverLetterId: string | null;
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
        {entry.resumeId && (
          <Link
            href={`/resume-builder/preview?resumeId=${entry.resumeId}`}
            className="underline underline-offset-2 hover:text-rust"
          >
            Resume used
          </Link>
        )}
        {entry.coverLetterId && (
          <Link
            href={`/resume-builder/preview?resumeId=${entry.coverLetterId}`}
            className="underline underline-offset-2 hover:text-rust"
          >
            Cover letter used
          </Link>
        )}
      </div>

      {entry.history.length > 1 && (
        <p className="text-[12px] italic text-ink-soft">
          {entry.history
            .map((h) => `${STAGE_LABEL[h.stage] ?? h.stage} (${formatDate(h.changedAt)})`)
            .join(" → ")}
        </p>
      )}

      <NotesForm applicationId={entry.id} notes={entry.notes} />
    </BorderedCard>
  );
}
