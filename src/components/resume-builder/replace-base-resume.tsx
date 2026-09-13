"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { ResumeUpload } from "@/components/onboarding/resume-upload";
import { replaceBaseResumeAction } from "@/lib/resume-builder/actions";
import { initialReplaceResumeState } from "@/lib/resume-builder/list-state";
import type { StructuredResume } from "@/lib/resume/types";

/**
 * The base resume's "Replace" flow — upload, preview, explicit confirm.
 *
 * Rendered inline below the base-resume row in ResumeListRow, the same
 * "expand in place, don't open a modal" pattern the delete-confirm card
 * already uses on this list (see that file's own header comment for why).
 *
 * THREE STEPS, NOT ONE. Uploading a file only ever calls
 * /api/resume-builder/import — the same parse-only endpoint the "Import my
 * CV" panel in the New Resume flow uses (start-state-chooser.tsx's
 * ImportPanel, "parsed" mode, which this mirrors). That route parses and
 * sanitizes but never writes to the database (see its own header comment).
 * So a parsed file only ever lands in this component's own React state
 * (`parsed`) — nothing is saved yet, and re-uploading a second or third file
 * before confirming can't have touched anything either. Only clicking
 * "Replace my resume" calls replaceBaseResumeAction, the one function on
 * this whole surface allowed to call upsertBaseResume.
 *
 * THIS IS THE ONE ACTION ON THIS PAGE WITH A REAL, IMMEDIATE DOWNSTREAM
 * EFFECT — unlike editing or renaming a non-base resume, which only affects
 * that one row. Auto-Apply submits the base resume on the user's behalf and
 * every future tailoring run reads it, so both the preview step and the
 * success message say so plainly rather than treating this like an ordinary
 * save.
 */

type Mode = "upload" | "parsed" | "done";

export function ReplaceBaseResume({ onCancel }: { onCancel: () => void }) {
  const [mode, setMode] = useState<Mode>("upload");
  const [parsed, setParsed] = useState<{ resume: StructuredResume; confidence: "high" | "low" } | null>(
    null,
  );
  const [confirming, startConfirm] = useTransition();
  const [result, setResult] = useState(initialReplaceResumeState);

  function confirmReplace() {
    if (!parsed) return;
    startConfirm(async () => {
      const outcome = await replaceBaseResumeAction(parsed.resume, parsed.confidence);
      setResult(outcome);
      if (outcome.status === "success") setMode("done");
    });
  }

  return (
    <div
      data-testid="replace-base-resume"
      className="flex flex-col gap-3 border-[1.5px] border-ink bg-card px-3.5 py-3"
    >
      {mode === "upload" && (
        <div className="flex flex-col gap-2">
          <ResumeUpload
            endpoint="/api/resume-builder/import"
            heading="Upload a new resume (PDF, DOCX, or plain text) — Farah will pull in your details before anything is saved."
            showSkip={false}
            onParsed={(uploaded) => {
              setParsed(uploaded);
              setMode("parsed");
            }}
          />
          <button
            type="button"
            onClick={onCancel}
            data-testid="replace-base-resume-cancel"
            className="text-left text-[13px] font-semibold text-ink-soft underline underline-offset-2 hover:text-coral"
          >
            Cancel
          </button>
        </div>
      )}

      {mode === "parsed" && parsed && (
        <div className="flex flex-col gap-3">
          <p className="text-[13.5px] text-ink-soft">
            Farah found {parsed.resume.skills.length} skill
            {parsed.resume.skills.length === 1 ? "" : "s"} and {parsed.resume.experience.length}{" "}
            work experience {parsed.resume.experience.length === 1 ? "entry" : "entries"}.
            {parsed.confidence === "low" &&
              " Some sections weren't clear — you'll be able to fill in the gaps afterward."}
          </p>
          <p className="text-[12.5px] italic text-ink-soft">
            This replaces your current base resume — the one Auto-Apply submits on your behalf and
            future tailoring starts from.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Button
              size="sm"
              type="button"
              onClick={confirmReplace}
              disabled={confirming}
              data-testid="replace-base-resume-confirm"
            >
              {confirming ? "Saving…" : "Replace my resume"}
            </Button>
            <button
              type="button"
              onClick={() => {
                setParsed(null);
                setMode("upload");
              }}
              data-testid="replace-base-resume-retry"
              className="text-left text-[13px] font-semibold text-ink-soft underline underline-offset-2 hover:text-coral"
            >
              Try a different file
            </button>
            <button
              type="button"
              onClick={onCancel}
              data-testid="replace-base-resume-cancel"
              className="text-left text-[13px] font-semibold text-ink-soft underline underline-offset-2 hover:text-coral"
            >
              Cancel
            </button>
          </div>
          {result.status === "error" && (
            <p
              data-testid="replace-base-resume-error"
              className="border-[1.5px] border-coral bg-coral-soft px-3 py-1.5 text-[12.5px] text-coral"
            >
              {result.error}
            </p>
          )}
        </div>
      )}

      {mode === "done" && (
        <div className="flex flex-col gap-2">
          <p
            data-testid="replace-base-resume-done"
            className="font-body text-[13.5px] font-semibold text-ink"
          >
            Your resume has been updated — Auto-Apply and future tailoring will use this version.
          </p>
          <button
            type="button"
            onClick={onCancel}
            className="text-left text-[13px] font-semibold text-ink-soft underline underline-offset-2 hover:text-coral"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
