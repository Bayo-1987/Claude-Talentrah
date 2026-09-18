"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { renderJobDescriptionMarkdown } from "@/lib/farah/render-markdown";
import { applyWithScreeningAction, type ScreeningAnswerInput } from "@/lib/applications/actions";
import type { CountryState } from "@/lib/jobs/country-events";
import { MAX_ASSESSMENT_FILES } from "@/lib/employer/assessment-document";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export interface PublicScreeningQuestion {
  id: string;
  questionText: string;
  questionType: "yes_no" | "min_number" | "free_text";
  required: boolean;
}

/**
 * send-346 v2 — the public-facing shape of a job posting's optional
 * assessment. `exerciseFiles` entries are already resolved, path-shape-
 * checked public URLs (assessmentExerciseFileUrl in
 * src/lib/employer/assessment-document.ts) — this component never sees a
 * raw `file_path` column, the same "resolve before it reaches a client
 * component" discipline bannerPublicUrl's own callers use. Widened by
 * send-364 from a single `exerciseFileUrl` to a list.
 */
export interface PublicAssessment {
  title: string;
  instructions: string;
  exerciseFiles: { url: string; name: string }[];
  exerciseLink: string | null;
  required: boolean;
}

interface AnswerState {
  yesNo?: boolean;
  number?: string;
  text?: string;
}

/**
 * send-327 — the candidate-facing side of employer-authored screening
 * questions, widened by send-346 v2 to also carry an optional assessment
 * section. Rendered INSTEAD of the plain `<form action={applyInAppAction}>`
 * whenever the job has EITHER questions OR an assessment (jobs/[id]/page.tsx
 * checks once, server-side, before choosing which of the two to render) —
 * all four combinations (neither, questions only, assessment only, both)
 * are handled by this one component; a job with neither keeps today's
 * exact one-click apply, untouched.
 *
 * ── DELIBERATELY NOT EXAM-TONED ─────────────────────────────────────────
 *
 * No pass/fail is ever shown to the candidate here, regardless of what they
 * answer — a failed question never blocks the application (0171's own
 * header, and 0177's assessment table has no grading to begin with), and a
 * rejection-toned message at apply time for something nobody has reviewed
 * yet would contradict that. This is framed as a quick self-assessment,
 * not a test: plain yes/no and number inputs, one "Submit application"
 * action at the end.
 *
 * ── THE FILE UPLOADS, IF ANY, HAPPEN INSIDE THE SAME SUBMIT CLICK ─────────
 *
 * A File cannot travel through applyWithScreeningAction's plain-argument
 * Server Action call, so if the candidate picked files (up to
 * MAX_ASSESSMENT_FILES, send-365), handleSubmit uploads each one FIRST to
 * /api/jobs/assessment-response — one call per file, that route's own
 * contract — to get back stored paths, THEN calls applyWithScreeningAction
 * with the resulting array as plain strings — the same two-step shape the
 * employer's own exercise upload already uses, just N uploads instead of
 * one, all still behind a single click.
 *
 * There is no cross-page redirect between picking and submitting here
 * (unlike the employer's create-form picker, which has to survive
 * postJobAction's redirect) — the picked File objects just sit in this
 * component's own React state until Submit is clicked, the identical
 * pattern the single-file version already used. No IndexedDB staging is
 * needed on this side of the feature.
 */
export function ScreeningGateApply({
  jobId,
  countryState,
  questions,
  assessment,
}: {
  jobId: string;
  countryState: CountryState;
  questions: PublicScreeningQuestion[];
  assessment?: PublicAssessment | null;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const [responseText, setResponseText] = useState("");
  const [responseLink, setResponseLink] = useState("");
  const [responseFiles, setResponseFiles] = useState<File[]>([]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const missingRequired =
    questions.some((q) => {
      if (!q.required) return false;
      const a = answers[q.id];
      if (!a) return true;
      if (q.questionType === "yes_no") return a.yesNo === undefined;
      if (q.questionType === "min_number") return !a.number;
      return !a.text || a.text.trim() === "";
    }) ||
    (!!assessment?.required &&
      !responseText.trim() &&
      !responseLink.trim() &&
      responseFiles.length === 0);

  function handleSubmit() {
    setError(null);
    const payload: ScreeningAnswerInput[] = [];
    for (const q of questions) {
      const a = answers[q.id];
      if (!a) continue;
      if (q.questionType === "yes_no" && a.yesNo !== undefined) {
        payload.push({ questionId: q.id, answerYesNo: a.yesNo });
      } else if (q.questionType === "min_number" && a.number) {
        const n = Number(a.number);
        if (Number.isFinite(n)) payload.push({ questionId: q.id, answerNumber: n });
      } else if (q.questionType === "free_text" && a.text && a.text.trim() !== "") {
        payload.push({ questionId: q.id, answerText: a.text.trim() });
      }
    }

    startTransition(async () => {
      const uploadedFiles: { path: string; originalFilename: string; byteSize: number }[] = [];
      if (assessment) {
        for (const file of responseFiles) {
          const body = new FormData();
          body.set("jobPostingId", jobId);
          body.set("file", file);
          const res = await fetch("/api/jobs/assessment-response", { method: "POST", body });
          const json = (await res.json().catch(() => ({}))) as { error?: string; path?: string };
          if (!res.ok || !json.path) {
            setError(json.error ?? `"${file.name}" didn't upload. Try again.`);
            return;
          }
          uploadedFiles.push({ path: json.path, originalFilename: file.name, byteSize: file.size });
        }
      }

      const result = await applyWithScreeningAction(
        jobId,
        countryState,
        payload,
        assessment
          ? {
              responseText: responseText.trim() || undefined,
              responseFiles: uploadedFiles.length > 0 ? uploadedFiles : undefined,
              // A link is only meaningful when no files were uploaded —
              // the exercise/response split is "alternatives, not both" on
              // both sides of this feature.
              responseLink: uploadedFiles.length === 0 ? responseLink.trim() || undefined : undefined,
            }
          : undefined,
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex w-full flex-col gap-4 border-[1.5px] border-ink bg-card p-5">
      <div className="flex flex-col gap-1">
        <span className="font-body text-[13px] font-semibold text-ink">
          A quick self-assessment before you apply
        </span>
        <p className="font-body text-[12.5px] text-ink-soft">
          {questions.length > 0 && assessment
            ? "The employer added a few questions and an assessment for this role. Your answers never block your application — they just help the employer see who's a fit faster."
            : assessment
              ? "The employer attached an assessment for this role, completed as part of applying."
              : "The employer added a few questions for this role. Your answers never block your application — they just help the employer see who's a fit faster."}
        </p>
      </div>

      {questions.map((q) => (
        <div key={q.id} className="flex flex-col gap-1.5">
          <label
            htmlFor={q.questionType !== "yes_no" ? `screening-answer-${q.id}` : undefined}
            className="font-body text-[13.5px] text-ink"
          >
            {q.questionText}
            {q.required && <span className="text-rust"> *</span>}
          </label>
          {q.questionType === "yes_no" ? (
            <div className="flex gap-4">
              {(["yes", "no"] as const).map((opt) => (
                <label key={opt} className="flex min-h-10 cursor-pointer items-center gap-1.5 font-body text-[13.5px] text-ink-soft">
                  <input
                    type="radio"
                    name={`screening-${q.id}`}
                    checked={answers[q.id]?.yesNo === (opt === "yes")}
                    onChange={() =>
                      setAnswers((prev) => ({ ...prev, [q.id]: { yesNo: opt === "yes" } }))
                    }
                    className="h-4 w-4"
                  />
                  {opt === "yes" ? "Yes" : "No"}
                </label>
              ))}
            </div>
          ) : q.questionType === "min_number" ? (
            <input
              id={`screening-answer-${q.id}`}
              type="number"
              value={answers[q.id]?.number ?? ""}
              onChange={(e) =>
                setAnswers((prev) => ({ ...prev, [q.id]: { number: e.target.value } }))
              }
              className="min-h-10 w-32 border-[1.5px] border-ink bg-card px-3 py-2 font-body text-[14px] text-ink outline-none focus:border-rust"
            />
          ) : (
            <textarea
              id={`screening-answer-${q.id}`}
              value={answers[q.id]?.text ?? ""}
              onChange={(e) =>
                setAnswers((prev) => ({ ...prev, [q.id]: { text: e.target.value } }))
              }
              maxLength={2000}
              rows={4}
              className="w-full border-[1.5px] border-ink bg-card px-3 py-2 font-body text-[14px] text-ink outline-none focus:border-rust"
            />
          )}
        </div>
      ))}

      {assessment && (
        <div className="flex flex-col gap-3 border-t border-line pt-4">
          <div className="flex flex-col gap-1">
            <span className="font-body text-[13.5px] font-semibold text-ink">
              {assessment.title}
              {assessment.required && <span className="text-rust"> *</span>}
            </span>
            <div className="font-body text-[13.5px] leading-relaxed text-ink-soft">
              {renderJobDescriptionMarkdown(assessment.instructions)}
            </div>
            {assessment.exerciseFiles.length > 0 && (
              <div className="flex flex-col gap-0.5">
                {assessment.exerciseFiles.map((file) => (
                  <a
                    key={file.url}
                    href={file.url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-body text-[13px] font-semibold text-ink underline underline-offset-2 hover:text-rust"
                  >
                    Download: {file.name}
                  </a>
                ))}
              </div>
            )}
            {assessment.exerciseLink && (
              <a
                href={assessment.exerciseLink}
                target="_blank"
                rel="noreferrer"
                className="font-body text-[13px] font-semibold text-ink underline underline-offset-2 hover:text-rust"
              >
                Open the exercise
              </a>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="assessment-response-text" className="font-body text-[13.5px] text-ink">
              Your response
            </label>
            <textarea
              id="assessment-response-text"
              value={responseText}
              onChange={(e) => setResponseText(e.target.value)}
              rows={4}
              placeholder="Write your answer here, or attach a file / link below instead."
              className="w-full border-[1.5px] border-ink bg-card px-3 py-2 font-body text-[14px] text-ink outline-none focus:border-rust"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="assessment-response-link" className="font-body text-[13.5px] text-ink">
              Or a link to your response
            </label>
            <input
              id="assessment-response-link"
              type="url"
              value={responseLink}
              onChange={(e) => setResponseLink(e.target.value)}
              placeholder="https://…"
              className="min-h-10 w-full border-[1.5px] border-ink bg-card px-3 py-2 font-body text-[14px] text-ink outline-none focus:border-rust"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="font-body text-[13.5px] text-ink">
              Or attach up to {MAX_ASSESSMENT_FILES} files
            </span>

            {responseFiles.length > 0 && (
              <ul className="flex flex-col gap-1.5">
                {responseFiles.map((file, index) => (
                  <li
                    key={`${file.name}-${index}`}
                    className="flex items-center justify-between gap-3 border-[1.5px] border-ink bg-card px-3 py-2"
                  >
                    <span className="truncate font-body text-[13px] text-ink-soft">
                      Selected: {file.name} ({formatBytes(file.size)})
                    </span>
                    <button
                      type="button"
                      onClick={() => setResponseFiles((prev) => prev.filter((_, i) => i !== index))}
                      className="min-h-8 shrink-0 px-2 font-body text-[12.5px] font-semibold text-ink-soft hover:text-rust"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {responseFiles.length >= MAX_ASSESSMENT_FILES ? (
              <p className="font-body text-[12.5px] text-ink-soft">
                {MAX_ASSESSMENT_FILES} of {MAX_ASSESSMENT_FILES} attached.
              </p>
            ) : (
              <label className="flex min-h-10 w-fit cursor-pointer items-center border-[1.5px] border-ink px-3.5 font-body text-[13px] font-semibold text-ink hover:border-rust hover:text-rust">
                Add file
                <input
                  id="assessment-response-file"
                  type="file"
                  multiple
                  accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                  className="hidden"
                  onChange={(e) => {
                    // Convert the live FileList to a real array BEFORE
                    // resetting the input's value below — `e.target.files`
                    // is a live view over the input's own selection, so
                    // clearing `value` empties it in place; a `const`
                    // holding the FileList reference (not a copy) would
                    // see it emptied too if read after the reset.
                    const picked = e.target.files ? Array.from(e.target.files) : [];
                    e.target.value = "";
                    if (picked.length === 0) return;
                    const room = MAX_ASSESSMENT_FILES - responseFiles.length;
                    if (room <= 0) return;
                    setResponseFiles((prev) => [...prev, ...picked.slice(0, room)]);
                  }}
                />
              </label>
            )}
          </div>
        </div>
      )}

      {error && <p className="font-body text-[12.5px] text-rust">{error}</p>}

      <div>
        <Button size="sm" type="button" disabled={pending || missingRequired} onClick={handleSubmit}>
          {pending ? "Submitting…" : "Submit application"}
        </Button>
      </div>
    </div>
  );
}
