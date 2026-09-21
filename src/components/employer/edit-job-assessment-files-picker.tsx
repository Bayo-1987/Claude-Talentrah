"use client";

import { useEffect, useState } from "react";
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
  "Couldn't hold onto these files for after saving — try attaching it again from here once the job's saved.";

/**
 * send-449 — the Edit-page counterpart to NewJobAssessmentFilesPicker,
 * shown ONLY while checking "Attach an assessment" for the FIRST time on
 * an already-existing job (`editContext && !initial` in AssessmentEditor —
 * the exact condition send-438's now-removed hint used).
 * Once an assessment exists, AssessmentExerciseUpload (the real,
 * immediately-usable widget) takes over and this never renders again.
 *
 * SAME staging module, SAME pattern as Create — reused, not reinvented —
 * with two differences the Edit case actually calls for, not stylistic
 * ones:
 *
 *  1. `scope` is this job's own real id, not the `CREATE_SCOPE` constant.
 *     A `job_posting_id` already exists here (only the assessment attached
 *     to it doesn't) — see pending-job-assessment-files.ts's own header on
 *     why a fixed key would let two different jobs' staged files collide,
 *     and why this component existing at all is what made that a real risk
 *     rather than a theoretical one.
 *  2. No BorderedCard/EyebrowLabel — this renders INSIDE AssessmentEditor's
 *     own bordered box, in the exact slot the old hint paragraph occupied,
 *     not as a second freestanding card the way Create's sits above the
 *     whole form.
 *
 * The submit-time cleanup still matters here even though Edit's own submit
 * navigates the whole page away (no same-page remount race to guard
 * against the way Create's pending-transition redirect has): unchecking
 * "Attach an assessment" after picking a file, then saving, sends no
 * assessment JSON at all — nothing will ever consume this scope's staged
 * entry, and it would sit in IndexedDB indefinitely without this.
 */
export function EditJobAssessmentFilesPicker({ userId, jobId }: { userId: string; jobId: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onSubmit() {
      clearIfNothingStagedThisSession(jobId, files.length > 0);
    }
    document.addEventListener("submit", onSubmit, true);
    return () => document.removeEventListener("submit", onSubmit, true);
  }, [files, jobId]);

  async function stage(next: File[]) {
    setFiles(next);
    try {
      await writePendingAssessmentFiles(jobId, userId, next);
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
    <div className="flex flex-col gap-2.5 border-t border-line pt-3">
      <p className="font-body text-[12.5px] text-ink-soft">
        Add up to {MAX_ASSESSMENT_FILES} exercise files here — {ASSESSMENT_DOCUMENT_GUIDANCE} They&rsquo;ll
        attach automatically once you save this job.
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
            id="edit-job-assessment-files"
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
