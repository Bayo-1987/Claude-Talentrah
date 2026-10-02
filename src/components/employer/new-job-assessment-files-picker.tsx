"use client";

import { useEffect, useState } from "react";
import { ASSESSMENT_DOCUMENT_GUIDANCE, MAX_ASSESSMENT_FILES } from "@/lib/employer/assessment-document";
import {
  CREATE_SCOPE,
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
 * exercise documents, staging into IndexedDB (see
 * pending-job-assessment-files.ts's own header for why IndexedDB rather
 * than the banner's sessionStorage, and why the write happens at pick/
 * remove time rather than at submit time the way the banner's does). Files
 * can't travel through a hidden form field, hence the staging at all.
 *
 * EMP-1 / E4 — this used to be a freestanding card ABOVE the form that did
 * not know whether "Attach an assessment" was ticked, and so was visible
 * regardless. It now renders inside AssessmentEditor, under that checkbox,
 * which hides it (kept mounted, so a pick survives unticking and re-ticking)
 * and passes `active`: whether the box is currently ticked. `active` matters
 * at ONE moment — submit: with the box unticked no assessment is saved, so
 * whatever is still staged would otherwise be consumed by the post-success
 * upload and fail against a job with nothing to attach to. Treating an
 * inactive picker as "nothing staged this session" lets the existing
 * cleanup clear it instead.
 */
export function NewJobAssessmentFilesPicker({ userId, active }: { userId: string; active: boolean }) {
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
      clearIfNothingStagedThisSession(CREATE_SCOPE, active && files.length > 0);
    }
    document.addEventListener("submit", onSubmit, true);
    return () => document.removeEventListener("submit", onSubmit, true);
  }, [files, active]);

  async function stage(next: File[]) {
    setFiles(next);
    try {
      await writePendingAssessmentFiles(CREATE_SCOPE, userId, next);
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
    <div className="flex flex-col gap-3">
      <p className="font-body text-[12.5px] text-ink-soft">
        Optional — add up to {MAX_ASSESSMENT_FILES} supporting files (a written brief, a spreadsheet, etc.) —{" "}
        {ASSESSMENT_DOCUMENT_GUIDANCE} They&rsquo;ll attach automatically once you publish.
      </p>

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
    </div>
  );
}
