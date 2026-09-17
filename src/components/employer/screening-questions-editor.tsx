"use client";

import { useState } from "react";
import { MAX_SCREENING_QUESTIONS, type ScreeningQuestionInput } from "@/lib/employer/screening-questions";

let nextKey = 0;
function freshKey(): string {
  nextKey += 1;
  return `new-${nextKey}`;
}

/** Same glyph as FilterChip's own removal affordance (filter-chip.tsx) — one inline SVG X, not a Unicode character. */
function RemoveGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 20 20" fill="none">
      <path d="M4 4 L16 16 M16 4 L4 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

interface Row extends ScreeningQuestionInput {
  /** Client-only React key — the submitted `id` (if any) travels separately. */
  key: string;
}

function toRow(q: ScreeningQuestionInput): Row {
  return { ...q, key: q.id ?? freshKey() };
}

const emptyRow = (): Row => ({
  key: freshKey(),
  questionText: "",
  questionType: "yes_no",
  required: true,
  expectedYesNo: true,
  minValue: null,
});

/** ≥40×40 hit target on add/remove — the same rule every other control on this app follows. */
const ICON_BUTTON =
  "flex min-h-10 min-w-10 items-center justify-center border-[1.5px] border-ink text-[13px] font-bold text-ink hover:border-rust hover:text-rust";

/**
 * send-327 — up to 5 employer-authored screening questions per posting.
 * Two types only (yes_no / min_number), matching migration 0171's own
 * constraint. Encodes the whole array as ONE hidden JSON input
 * (`screeningQuestions`) rather than indexed field names, the same reason a
 * `structured_jd` payload is JSON rather than fifty named columns — this
 * has real per-row structure (four sub-fields, one of two shapes) that a
 * flat FormData key list would make painful to reassemble correctly server
 * side. Read back and validated (never trusted) by
 * `parseScreeningQuestionsForm` (screening-questions.ts).
 */
export function ScreeningQuestionsEditor({ initial = [] }: { initial?: ScreeningQuestionInput[] }) {
  const [rows, setRows] = useState<Row[]>(() => initial.map(toRow));

  function update(key: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addRow() {
    if (rows.length >= MAX_SCREENING_QUESTIONS) return;
    setRows((prev) => [...prev, emptyRow()]);
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  const payload: ScreeningQuestionInput[] = rows.map((r) => ({
    id: r.id,
    questionText: r.questionText,
    questionType: r.questionType,
    required: r.required,
    expectedYesNo: r.questionType === "yes_no" ? r.expectedYesNo : null,
    minValue: r.questionType === "min_number" ? r.minValue : null,
  }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="font-body text-[13px] font-semibold text-ink-soft">
          Screening questions (optional)
        </span>
        <p className="font-body text-[12.5px] text-ink-soft">
          A quick self-assessment shown to candidates before they apply — pass/fail never blocks
          an application, it just helps you see who&apos;s a fit faster. Up to {MAX_SCREENING_QUESTIONS}.
        </p>
      </div>

      {rows.map((row) => (
        <div key={row.key} className="flex flex-col gap-3 border-[1.5px] border-ink bg-card p-4">
          <div className="flex items-start gap-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <label className="font-body text-[12.5px] font-semibold text-ink-soft">Question</label>
              <input
                type="text"
                value={row.questionText}
                onChange={(e) => update(row.key, { questionText: e.target.value })}
                placeholder="e.g. Authorised to work in Nigeria?"
                className="min-h-11 border-[1.5px] border-ink bg-card px-3.5 py-2.5 font-body text-[15px] text-ink outline-none focus:border-rust"
              />
            </div>
            <button
              type="button"
              onClick={() => removeRow(row.key)}
              aria-label={`Remove question: ${row.questionText || "untitled"}`}
              className={`${ICON_BUTTON} mt-6`}
            >
              <RemoveGlyph />
            </button>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="font-body text-[12.5px] font-semibold text-ink-soft">Type</label>
              <select
                value={row.questionType}
                onChange={(e) =>
                  update(row.key, { questionType: e.target.value as ScreeningQuestionInput["questionType"] })
                }
                className="min-h-11 border-[1.5px] border-ink bg-card px-3.5 py-2.5 font-body text-[15px] text-ink outline-none focus:border-rust"
              >
                <option value="yes_no">Yes / No</option>
                <option value="min_number">Minimum number</option>
              </select>
            </div>

            {row.questionType === "yes_no" ? (
              <div className="flex flex-col gap-1.5">
                <label className="font-body text-[12.5px] font-semibold text-ink-soft">Passing answer</label>
                <select
                  value={row.expectedYesNo ? "yes" : "no"}
                  onChange={(e) => update(row.key, { expectedYesNo: e.target.value === "yes" })}
                  className="min-h-11 border-[1.5px] border-ink bg-card px-3.5 py-2.5 font-body text-[15px] text-ink outline-none focus:border-rust"
                >
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <label className="font-body text-[12.5px] font-semibold text-ink-soft">
                  Minimum to pass
                </label>
                <input
                  type="number"
                  value={row.minValue ?? ""}
                  onChange={(e) => update(row.key, { minValue: e.target.value ? Number(e.target.value) : null })}
                  className="min-h-11 w-32 border-[1.5px] border-ink bg-card px-3.5 py-2.5 font-body text-[15px] text-ink outline-none focus:border-rust"
                />
              </div>
            )}

            <label className="mb-2.5 flex min-h-10 cursor-pointer items-center gap-2 font-body text-[13px] text-ink-soft">
              <input
                type="checkbox"
                checked={row.required}
                onChange={(e) => update(row.key, { required: e.target.checked })}
                className="h-4 w-4 border-[1.5px] border-ink"
              />
              Required
            </label>
          </div>
        </div>
      ))}

      {rows.length < MAX_SCREENING_QUESTIONS && (
        <button type="button" onClick={addRow} className={`${ICON_BUTTON} w-fit px-3.5`}>
          + Add question
        </button>
      )}

      <input type="hidden" name="screeningQuestions" value={JSON.stringify(payload)} />
    </div>
  );
}
