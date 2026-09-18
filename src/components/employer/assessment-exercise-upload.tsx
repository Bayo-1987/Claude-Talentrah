"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ASSESSMENT_DOCUMENT_GUIDANCE } from "@/lib/employer/assessment-document";

/**
 * send-346 v2 — the exercise-document upload widget, EDIT-PAGE ONLY, same
 * scoping JobBannerUpload originally had before send-134's create-form
 * staging: the object path is `<organization_id>/<job_posting_id>.<ext>`,
 * which needs a job_posting_id that doesn't exist yet on a brand-new
 * posting. An employer attaching an assessment to a NEW posting sets
 * title/instructions/link/required at creation time (AssessmentEditor,
 * plain form fields) and adds the actual file afterward from here.
 *
 * Requires the posting to already have title/instructions saved — see
 * /api/employer/job-assessment-exercise's own guard, surfaced here as a
 * plain error message rather than silently disabled, since "why can't I
 * upload" is a worse experience than a clear one-line answer.
 */
export function AssessmentExerciseUpload({
  jobId,
  currentFileUrl,
  hasAssessment,
}: {
  jobId: string;
  currentFileUrl: string | null;
  /** Whether job_posting_assessments has a row at all yet — the upload route needs one to attach to. */
  hasAssessment: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setPending(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("jobId", jobId);
      body.set("file", file);
      const res = await fetch("/api/employer/job-assessment-exercise", { method: "POST", body });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "That upload didn't go through.");
        return;
      }
      router.refresh();
    } catch {
      setError("That upload didn't go through. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  if (!hasAssessment) return null;

  return (
    <div className="flex flex-col gap-2">
      <p className="font-body text-[12.5px] text-ink-soft">
        Exercise document — {ASSESSMENT_DOCUMENT_GUIDANCE} Uploading a file replaces any link set
        above.
      </p>
      {currentFileUrl && (
        <p className="font-body text-[13px]">
          <a
            href={currentFileUrl}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-ink underline underline-offset-2 hover:text-rust"
          >
            View the current file
          </a>
        </p>
      )}
      <label className="flex min-h-10 w-fit cursor-pointer items-center border-[1.5px] border-ink px-3.5 font-body text-[13px] font-semibold text-ink hover:border-rust hover:text-rust">
        {pending ? "Uploading…" : currentFileUrl ? "Replace file" : "Upload file"}
        <input
          type="file"
          accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
          className="hidden"
          disabled={pending}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void handleFile(file);
          }}
        />
      </label>
      {error && <p className="font-body text-[12.5px] text-rust">{error}</p>}
    </div>
  );
}
