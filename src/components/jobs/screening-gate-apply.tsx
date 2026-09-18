"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { applyWithScreeningAction, type ScreeningAnswerInput } from "@/lib/applications/actions";
import type { CountryState } from "@/lib/jobs/country-events";

export interface PublicScreeningQuestion {
  id: string;
  questionText: string;
  questionType: "yes_no" | "min_number" | "free_text";
  required: boolean;
}

interface AnswerState {
  yesNo?: boolean;
  number?: string;
  text?: string;
}

/**
 * send-327 — the candidate-facing side of employer-authored screening
 * questions. Rendered INSTEAD of the plain `<form action={applyInAppAction}>`
 * only when the job actually has questions (jobs/[id]/page.tsx checks once,
 * server-side, before choosing which of the two to render) — a job with no
 * questions keeps today's exact one-click apply, untouched.
 *
 * ── DELIBERATELY NOT EXAM-TONED ─────────────────────────────────────────
 *
 * No pass/fail is ever shown to the candidate here, regardless of what they
 * answer — a failed question never blocks the application (0171's own
 * header), and a rejection-toned message at apply time for something
 * nobody has reviewed yet would contradict that. This is framed as a quick
 * self-assessment, not a test: plain yes/no and number inputs, one
 * "Submit application" action at the end.
 */
export function ScreeningGateApply({
  jobId,
  countryState,
  questions,
}: {
  jobId: string;
  countryState: CountryState;
  questions: PublicScreeningQuestion[];
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const missingRequired = questions.some((q) => {
    if (!q.required) return false;
    const a = answers[q.id];
    if (!a) return true;
    if (q.questionType === "yes_no") return a.yesNo === undefined;
    if (q.questionType === "min_number") return !a.number;
    return !a.text || a.text.trim() === "";
  });

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
      const result = await applyWithScreeningAction(jobId, countryState, payload);
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
          The employer added a few questions for this role. Your answers never block your
          application — they just help the employer see who&apos;s a fit faster.
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

      {error && <p className="font-body text-[12.5px] text-rust">{error}</p>}

      <div>
        <Button size="sm" type="button" disabled={pending || missingRequired} onClick={handleSubmit}>
          {pending ? "Submitting…" : "Submit application"}
        </Button>
      </div>
    </div>
  );
}
