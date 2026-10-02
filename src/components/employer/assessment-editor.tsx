"use client";

import { useState } from "react";
import { RichMarkdownEditor } from "./rich-markdown-editor";
import { EditJobAssessmentFilesPicker } from "./edit-job-assessment-files-picker";
import { NewJobAssessmentFilesPicker } from "./new-job-assessment-files-picker";
import { AssessmentExerciseUpload, type AssessmentExerciseFile } from "./assessment-exercise-upload";
import { EyebrowLabel } from "@/components/ui";
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
 *
 * send-438 introduced `filesUnlockAfterSave`, a hint explaining that gap
 * ("save this job to unlock attaching a file here"). send-449 replaces the
 * explanation with the actual capability: `editContext`, present only on
 * the Edit page, renders EditJobAssessmentFilesPicker instead — the same
 * staging-then-upload-on-save pattern NewJobAssessmentFilesPicker already
 * uses on Create, extended to cover "the posting exists, the assessment
 * doesn't yet." Still can't be inferred from `initial` alone (`!initial`
 * is also true on Create, where files can already be staged a completely
 * different way — passing `editContext` there would be actively wrong,
 * not just redundant), so it's still an explicit prop from the one caller
 * whose picture matches it, undefined everywhere else.
 *
 * EMP-1 / E4 — every exercise-files control now lives HERE, under the
 * "Attach an assessment" checkbox, and is visible only while it is ticked.
 * They used to be separate cards outside the form (above it on Create, below
 * it on Edit) shown whether or not an assessment was being attached.
 *
 * What UNTICKING does, per case — it hides, it never deletes:
 *  - Create (`createContext`): the staging picker stays MOUNTED, just
 *    `hidden`, because what was picked is client-only state — unmounting it
 *    would throw the list away (while leaving the files in IndexedDB, an
 *    invisible attachment on re-tick). On submit while unticked the staged
 *    files are discarded: no assessment is saved to attach them to.
 *  - Edit with a saved assessment (`savedFiles`): those files live on the
 *    server and the section is just derived from props, so it simply isn't
 *    rendered while unticked and is back, unchanged, on re-tick. They go only
 *    if the employer SAVES unticked, which removes the assessment itself
 *    (unchanged behaviour).
 *  - Edit with no assessment yet: EditJobAssessmentFilesPicker, unchanged.
 */
export function AssessmentEditor({
  initial,
  editContext,
  createContext,
  savedFiles,
}: {
  initial?: JobPostingAssessmentInput | null;
  /** Present only on the Edit page — see this component's own header. */
  editContext?: { jobId: string; userId: string };
  /** Present only on the Create page: where exercise files are staged until the job exists. */
  createContext?: { userId: string };
  /** Edit page only: the exercise files already uploaded to the saved assessment. */
  savedFiles?: AssessmentExerciseFile[];
}) {
  const [enabled, setEnabled] = useState(!!initial);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [instructions, setInstructions] = useState(initial?.instructions ?? "");
  const [exerciseLink, setExerciseLink] = useState(initial?.exerciseLink ?? "");
  const [required, setRequired] = useState(initial?.required ?? true);

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
            {/*
              send-367 — same rich editor as the job description field, no
              `name` (its serialized text feeds `instructions` state below
              via onTextChange, then travels inside this component's own
              `jobPostingAssessment` JSON hidden input, not as its own form
              field). See rich-markdown-editor.tsx's own header for why the
              stored/rendered format is unaffected either way.
            */}
            <RichMarkdownEditor
              id="assessment-instructions"
              label="Instructions"
              defaultValue={instructions}
              // send-448 — "Optional" up front now that submitting this
              // blank is genuinely valid: a link or an uploaded file can
              // carry the actual content instead. Left the visible <label>
              // text itself as plain "Instructions" — e2e/job-posting-
              // assessment.spec.ts's getByLabel("Instructions", { exact:
              // true }) depends on that exact accessible name in four
              // places, and the placeholder is where this repo's own
              // convention (see the link field just below) already signals
              // optionality for a field whose label doesn't carry it.
              placeholder="Optional — what should the candidate do, and how should they submit it? Skip this if a link or file below covers it."
              minHeightClassName="min-h-[160px]"
              onTextChange={setInstructions}
            />
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

          {editContext && !initial && (
            <EditJobAssessmentFilesPicker userId={editContext.userId} jobId={editContext.jobId} />
          )}

          {editContext && initial && savedFiles && (
            <div id="assessment-exercise-files" className="flex flex-col gap-2.5 border-t border-line pt-3">
              <EyebrowLabel>Assessment exercise files</EyebrowLabel>
              <AssessmentExerciseUpload jobId={editContext.jobId} hasAssessment files={savedFiles} />
            </div>
          )}
        </div>
      )}

      {/*
        Create only. Outside the `enabled &&` blocks on purpose — see the
        header: hidden, not unmounted, so unticking never loses a pick. The
        `hidden` sits on a plain wrapper with no display class of its own, so
        nothing can override it.
      */}
      {createContext && (
        <div id="assessment-exercise-files" hidden={!enabled}>
          <div className="flex flex-col gap-2.5 border-t border-line pt-3">
            <EyebrowLabel>Assessment exercise files</EyebrowLabel>
            <NewJobAssessmentFilesPicker userId={createContext.userId} active={enabled} />
          </div>
        </div>
      )}

      {enabled && (
        <div className="flex flex-col gap-3">
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
