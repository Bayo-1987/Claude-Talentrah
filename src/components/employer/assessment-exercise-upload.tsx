"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ASSESSMENT_DOCUMENT_GUIDANCE, MAX_ASSESSMENT_FILES } from "@/lib/employer/assessment-document";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export interface AssessmentExerciseFile {
  id: string;
  url: string | null;
  originalFilename: string;
  byteSize: number;
}

/**
 * send-364 — the exercise-files list widget, widened from a single-file
 * "Upload/Replace" control (send-346 v2) to a list with a delete per file
 * and an "Add file" control that respects MAX_ASSESSMENT_FILES. Still
 * rendered on Edit (job.id always exists there); ALSO reachable indirectly
 * on the create flow now via PostSuccessAssessmentFilesNote, which uploads
 * through this same /api/employer/job-assessment-exercise route directly
 * rather than through this component — this widget itself stays Edit-only,
 * since Edit is where an employer manages what's already attached.
 *
 * Requires the posting to already have title/instructions saved — see
 * /api/employer/job-assessment-exercise's own guard, surfaced here as a
 * plain error message rather than silently disabled, since "why can't I
 * upload" is a worse experience than a clear one-line answer.
 */
export function AssessmentExerciseUpload({
  jobId,
  files,
  hasAssessment,
}: {
  jobId: string;
  files: AssessmentExerciseFile[];
  /** Whether job_posting_assessments has a row at all yet — the upload route needs one to attach to. */
  hasAssessment: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
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

  async function handleRemove(fileId: string) {
    setRemovingId(fileId);
    setError(null);
    try {
      const res = await fetch("/api/employer/job-assessment-exercise", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, fileId }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "That file couldn't be removed.");
        return;
      }
      router.refresh();
    } catch {
      setError("That file couldn't be removed. Check your connection and try again.");
    } finally {
      setRemovingId(null);
    }
  }

  if (!hasAssessment) return null;

  const atCap = files.length >= MAX_ASSESSMENT_FILES;

  return (
    <div className="flex flex-col gap-2">
      <p className="font-body text-[12.5px] text-ink-soft">
        Exercise files — {ASSESSMENT_DOCUMENT_GUIDANCE} Up to {MAX_ASSESSMENT_FILES}. Uploading a file
        clears any link set above.
      </p>

      {files.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {files.map((file) => (
            <li
              key={file.id}
              className="flex items-center justify-between gap-3 border-[1.5px] border-ink bg-card px-3 py-2"
            >
              {file.url ? (
                <a
                  href={file.url}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate font-body text-[13px] font-semibold text-ink underline underline-offset-2 hover:text-rust"
                >
                  {file.originalFilename} <span className="font-normal text-ink-soft">({formatBytes(file.byteSize)})</span>
                </a>
              ) : (
                <span className="truncate font-body text-[13px] text-ink-soft">
                  {file.originalFilename} ({formatBytes(file.byteSize)})
                </span>
              )}
              <button
                type="button"
                disabled={removingId === file.id}
                onClick={() => void handleRemove(file.id)}
                className="min-h-8 shrink-0 px-2 font-body text-[12.5px] font-semibold text-ink-soft hover:text-rust disabled:cursor-not-allowed disabled:opacity-50"
              >
                {removingId === file.id ? "Removing…" : "Remove"}
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
          {pending ? "Uploading…" : "Add file"}
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
      )}

      {error && <p className="font-body text-[12.5px] text-rust">{error}</p>}
    </div>
  );
}
