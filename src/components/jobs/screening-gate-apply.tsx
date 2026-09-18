"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { renderJobDescriptionMarkdown } from "@/lib/farah/render-markdown";
import { applyWithScreeningAction, type ScreeningAnswerInput } from "@/lib/applications/actions";
import type { CountryState } from "@/lib/jobs/country-events";

export interface PublicScreeningQuestion {
  id: string;
  questionText: string;
  questionType: "yes_no" | "min_number" | "free_text";
  required: boolean;
}

/**
 * send-346 v2 — the public-facing shape of a job posting's optional
 * assessment. `exerciseFileUrl` is already the resolved, path-shape-
 * checked public URL (assessmentExerciseUrl in
 * src/lib/employer/assessment-document.ts) — this component never sees
 * the raw `exercise_file_path` column, the same "resolve before it reaches
 * a client component" discipline bannerPublicUrl's own callers use.
 */
export interface PublicAssessment {
  title: string;
  instructions: string;
  exerciseFileUrl: string | null;
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
 * ── THE FILE UPLOAD, IF ANY, HAPPENS INSIDE THE SAME SUBMIT CLICK ─────────
 *
 * A File cannot travel through applyWithScreeningAction's plain-argument
 * Server Action call, so if the candidate picked a file, handleSubmit
 * uploads it FIRST to /api/jobs/assessment-response to get back a stored
 * path, THEN calls applyWithScreeningAction with that path as a plain
 * string — the same two-step shape the employer's own exercise upload
 * already uses (AssessmentExerciseUpload), just both steps behind one
 * click instead of two separate ones.
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
  const [responseFile, setResponseFile] = useState<File | null>(null);
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
      !responseFile);

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
      let responseFilePath: string | undefined;
      if (assessment && responseFile) {
        const body = new FormData();
        body.set("jobPostingId", jobId);
        body.set("file", responseFile);
        const res = await fetch("/api/jobs/assessment-response", { method: "POST", body });
        const json = (await res.json().catch(() => ({}))) as { error?: string; path?: string };
        if (!res.ok || !json.path) {
          setError(json.error ?? "That file didn't upload. Try again.");
          return;
        }
        responseFilePath = json.path;
      }

      const result = await applyWithScreeningAction(
        jobId,
        countryState,
        payload,
        assessment
          ? {
              responseText: responseText.trim() || undefined,
              responseFilePath,
              // A link is only meaningful when no file was uploaded — the
              // exercise/response split is "alternatives, not both" on
              // both sides of this feature.
              responseLink: !responseFilePath ? responseLink.trim() || undefined : undefined,
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
            {assessment.exerciseFileUrl && (
              <a
                href={assessment.exerciseFileUrl}
                target="_blank"
                rel="noreferrer"
                className="font-body text-[13px] font-semibold text-ink underline underline-offset-2 hover:text-rust"
              >
                Download the exercise
              </a>
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
            <label htmlFor="assessment-response-file" className="font-body text-[13.5px] text-ink">
              Or attach a file
            </label>
            <input
              id="assessment-response-file"
              type="file"
              accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
              onChange={(e) => setResponseFile(e.target.files?.[0] ?? null)}
              className="font-body text-[13px] text-ink-soft"
            />
            {responseFile && (
              <p className="font-body text-[12.5px] text-ink-soft">Selected: {responseFile.name}</p>
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
