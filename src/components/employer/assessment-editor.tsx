"use client";

import { useRef, useState } from "react";
import { MarkdownToolbar } from "./markdown-toolbar";
import { renderJobDescriptionMarkdown } from "@/lib/farah/render-markdown";
import type { JobPostingAssessmentInput } from "@/lib/employer/job-posting-assessment";

/**
 * send-346 v2 — "Attach an assessment (optional)" section, the same hidden-
 * JSON-input convention ScreeningQuestionsEditor already uses for its own
 * per-posting extra: one `jobPostingAssessment` field, `""` meaning "no
 * assessment" (or "remove the one that was there"), a JSON object
 * otherwise. Parsed and reconciled by
 * src/lib/employer/job-posting-assessment.ts.
 *
 * The exercise FILE itself is NOT part of this component — a File can't
 * travel through a hidden form input, so it's a separate sibling upload
 * widget (AssessmentExerciseUpload, below) shown only on the edit page,
 * mirroring JobBannerUpload's own identical split for the identical
 * reason: the upload needs a job_posting_id that doesn't exist yet on a
 * brand-new posting.
 */
export function AssessmentEditor({ initial }: { initial?: JobPostingAssessmentInput | null }) {
  const [enabled, setEnabled] = useState(!!initial);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [instructions, setInstructions] = useState(initial?.instructions ?? "");
  const [exerciseLink, setExerciseLink] = useState(initial?.exerciseLink ?? "");
  const [required, setRequired] = useState(initial?.required ?? true);
  const [previewText, setPreviewText] = useState<string | null>(null);

  const instructionsRef = useRef<HTMLTextAreaElement>(null);

  function syncInstructionsState() {
    setInstructions(instructionsRef.current?.value ?? "");
  }

  const payload = enabled
    ? JSON.stringify({
        title,
        instructions,
        exerciseLink: exerciseLink.trim() || null,
        required,
      } satisfies JobPostingAssessmentInput)
    : "";

  return (
    <div className="flex flex-col gap-3 border-[1.5px] border-ink bg-card p-4">
      <label className="flex min-h-10 cursor-pointer items-center gap-2 font-body text-[13px] font-semibold text-ink-soft">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4 border-[1.5px] border-ink"
        />
        Attach an assessment (optional)
      </label>
      <p className="font-body text-[12.5px] text-ink-soft">
        A short exercise seekers complete as part of applying — instructions plus an uploaded
        document or a link. Submitted alongside the resume, before the application finishes.
      </p>

      {enabled && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="assessment-title" className="font-body text-[12.5px] font-semibold text-ink-soft">
              Title
            </label>
            <input
              id="assessment-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Take-home SQL exercise"
              className="min-h-11 border-[1.5px] border-ink bg-card px-3.5 py-2.5 font-body text-[15px] text-ink outline-none focus:border-rust"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="assessment-instructions" className="font-body text-[12.5px] font-semibold text-ink-soft">
                Instructions
              </label>
              <button
                type="button"
                aria-label={previewText === null ? "Preview instructions" : "Edit instructions"}
                onClick={() =>
                  setPreviewText((current) => (current === null ? instructionsRef.current?.value ?? "" : null))
                }
                className="min-h-10 border-[1.5px] border-ink px-3.5 font-body text-[13px] font-semibold text-ink hover:border-rust hover:text-rust"
              >
                {previewText === null ? "Preview" : "Edit"}
              </button>
            </div>

            <div className={previewText !== null ? "hidden" : "flex flex-col gap-1.5"}>
              <MarkdownToolbar textareaRef={instructionsRef} onFormat={syncInstructionsState} />
              <textarea
                id="assessment-instructions"
                ref={instructionsRef}
                defaultValue={instructions}
                onChange={syncInstructionsState}
                rows={6}
                placeholder="What should the candidate do, and how should they submit it?"
                className="border-[1.5px] border-ink bg-card px-3.5 py-2.5 font-body text-[15px] leading-[1.65] text-ink outline-none focus:border-rust"
              />
            </div>

            {previewText !== null && (
              <div className="min-h-[120px] border-[1.5px] border-ink bg-card px-3.5 py-2.5">
                {previewText.trim() ? (
                  renderJobDescriptionMarkdown(previewText)
                ) : (
                  <p className="font-body text-[15px] italic text-ink-soft">Nothing to preview yet.</p>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="assessment-link" className="font-body text-[12.5px] font-semibold text-ink-soft">
              Link to the exercise (optional — an alternative to uploading a file below)
            </label>
            <input
              id="assessment-link"
              type="url"
              value={exerciseLink}
              onChange={(e) => setExerciseLink(e.target.value)}
              placeholder="https://…"
              className="min-h-11 border-[1.5px] border-ink bg-card px-3.5 py-2.5 font-body text-[15px] text-ink outline-none focus:border-rust"
            />
          </div>

          {/*
            "Required to apply", not the bare "Required" screening
            questions use — a job can have both a screening question and an
            assessment on the same page, and two identically-labeled
            checkboxes would be ambiguous for a sighted employer reading
            the form, not just for a getByLabel query.
          */}
          <label className="flex min-h-10 cursor-pointer items-center gap-2 font-body text-[13px] text-ink-soft">
            <input
              type="checkbox"
              checked={required}
              onChange={(e) => setRequired(e.target.checked)}
              className="h-4 w-4 border-[1.5px] border-ink"
            />
            Required to apply
          </label>
        </div>
      )}

      <input type="hidden" name="jobPostingAssessment" value={payload} />
    </div>
  );
}
