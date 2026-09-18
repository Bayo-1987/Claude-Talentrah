"use client";

import { useEffect, useState } from "react";
import { BorderedCard, EyebrowLabel } from "@/components/ui";
import { ASSESSMENT_DOCUMENT_GUIDANCE, MAX_ASSESSMENT_FILES } from "@/lib/employer/assessment-document";
import {
  clearIfNothingStagedThisSession,
  writePendingAssessmentFiles,
} from "@/lib/employer/pending-job-assessment-files";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const STAGE_FAILED_MESSAGE =
  "Couldn't hold onto these files for after publishing — add them from the job's edit page once it's posted.";

/**
 * send-364 — the create form's own multi-file picker for the assessment's
 * exercise documents, mirroring new-job-banner-picker.tsx's own pattern: an
 * independent card rendered ABOVE the form (files can't travel through a
 * hidden form field), staging into IndexedDB (see
 * pending-job-assessment-files.ts's own header for why IndexedDB rather
 * than the banner's sessionStorage, and why the write happens at pick/
 * remove time rather than at submit time the way the banner's does).
 *
 * Deliberately does NOT know whether the employer has checked "Attach an
 * assessment" in AssessmentEditor (a sibling INSIDE JobPostingForm's own
 * `<form>` — this card has to live outside it, so there's no cheap way to
 * share that boolean without touching that component's own contract, which
 * is more than this fix needs). If files are staged but no assessment ever
 * gets created, the post-success upload attempt fails gracefully with the
 * same "add it from Edit" pointer PostSuccessAssessmentFilesNote already
 * falls back to for any other deferred-upload failure — not a special case,
 * just this component's copy making the relationship clear up front instead.
 */
export function NewJobAssessmentFilesPicker({ userId }: { userId: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Re-registered whenever `files` changes so the closure below always
  // sees the current list — simpler than a ref kept in sync during render,
  // which React's own rules disallow (refs are for effects/handlers, not
  // render). A capturing listener with a fresh closure per render is cheap
  // enough here: this component re-renders only on pick/remove, not on
  // every keystroke.
  useEffect(() => {
    function onSubmit() {
      clearIfNothingStagedThisSession(files.length > 0);
    }
    document.addEventListener("submit", onSubmit, true);
    return () => document.removeEventListener("submit", onSubmit, true);
  }, [files]);

  async function stage(next: File[]) {
    setFiles(next);
    try {
      await writePendingAssessmentFiles(userId, next);
      setError(null);
    } catch {
      setError(STAGE_FAILED_MESSAGE);
    }
  }

  function handlePicked(picked: FileList | null) {
    if (!picked || picked.length === 0) return;
    const room = MAX_ASSESSMENT_FILES - files.length;
    if (room <= 0) return;
    const additions = Array.from(picked).slice(0, room);
    void stage([...files, ...additions]);
  }

  function handleRemove(index: number) {
    void stage(files.filter((_, i) => i !== index));
  }

  const atCap = files.length >= MAX_ASSESSMENT_FILES;

  return (
    <BorderedCard className="flex flex-col gap-3 p-5">
      <div className="flex flex-col gap-1">
        <EyebrowLabel>Assessment exercise files — optional</EyebrowLabel>
        <p className="text-[13.5px] text-ink-soft">
          If you&rsquo;re attaching an assessment below, add up to {MAX_ASSESSMENT_FILES} supporting files
          here (a written brief, a spreadsheet, etc.) — {ASSESSMENT_DOCUMENT_GUIDANCE} They&rsquo;ll attach
          automatically once you publish.
        </p>
      </div>

      {files.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="flex items-center justify-between gap-3 border-[1.5px] border-ink bg-card px-3 py-2"
            >
              <span className="truncate font-body text-[13px] text-ink">
                {file.name} <span className="text-ink-soft">({formatBytes(file.size)})</span>
              </span>
              <button
                type="button"
                onClick={() => handleRemove(index)}
                className="min-h-8 shrink-0 px-2 font-body text-[12.5px] font-semibold text-ink-soft hover:text-rust"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {atCap ? (
        <p className="font-body text-[12.5px] text-ink-soft">
          {MAX_ASSESSMENT_FILES} of {MAX_ASSESSMENT_FILES} attached.
        </p>
      ) : (
        <label className="flex min-h-10 w-fit cursor-pointer items-center border-[1.5px] border-ink px-3.5 font-body text-[13px] font-semibold text-ink hover:border-rust hover:text-rust">
          Add file
          <input
            id="new-job-assessment-files"
            type="file"
            multiple
            accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
            className="hidden"
            onChange={(e) => {
              handlePicked(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      )}

      {error && <p className="font-body text-[12.5px] text-rust">{error}</p>}
    </BorderedCard>
  );
}
