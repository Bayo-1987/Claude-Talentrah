import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export const MAX_SCREENING_QUESTIONS = 5;

export type ScreeningQuestionType = "yes_no" | "min_number";

/** The shape the client editor produces, JSON-encoded into one hidden input. */
export interface ScreeningQuestionInput {
  /** Present only for a question that already exists (editing) — absent for a new one. */
  id?: string;
  questionText: string;
  questionType: ScreeningQuestionType;
  required: boolean;
  expectedYesNo: boolean | null;
  minValue: number | null;
}

/**
 * Reads and validates the `screeningQuestions` hidden JSON input.
 *
 * Never trusted as-is — the client editor already enforces most of this
 * (see screening-questions-editor.tsx), but this is the boundary where a
 * hand-crafted request is caught rather than silently writing an
 * inconsistent row (a `yes_no` question with a `minValue`, an over-cap
 * question list) the way `readJobForm`'s own re-check of `skills` against
 * `SCREENABLE_SKILL_SET` already does for the sibling field.
 */
export function parseScreeningQuestionsForm(
  form: FormData,
): { ok: true; value: ScreeningQuestionInput[] } | { ok: false; error: string } {
  const raw = form.get("screeningQuestions");
  if (!raw || typeof raw !== "string" || raw.trim() === "") return { ok: true, value: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Screening questions were submitted in an unreadable format." };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: "Screening questions were submitted in an unreadable format." };
  }
  if (parsed.length > MAX_SCREENING_QUESTIONS) {
    return { ok: false, error: `A job posting may have at most ${MAX_SCREENING_QUESTIONS} screening questions.` };
  }

  const value: ScreeningQuestionInput[] = [];
  for (const raw of parsed) {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: "One of the screening questions was submitted in an unreadable format." };
    }
    const q = raw as Record<string, unknown>;
    const questionText = typeof q.questionText === "string" ? q.questionText.trim() : "";
    if (!questionText) return { ok: false, error: "Every screening question needs its question text filled in." };

    const questionType = q.questionType;
    if (questionType !== "yes_no" && questionType !== "min_number") {
      return { ok: false, error: `"${questionText}" has an invalid question type.` };
    }

    const required = q.required !== false;
    const id = typeof q.id === "string" && q.id ? q.id : undefined;

    if (questionType === "yes_no") {
      if (typeof q.expectedYesNo !== "boolean") {
        return { ok: false, error: `"${questionText}" needs a Yes or No answer marked as passing.` };
      }
      value.push({ id, questionText, questionType, required, expectedYesNo: q.expectedYesNo, minValue: null });
    } else {
      const minValue = typeof q.minValue === "number" ? q.minValue : Number(q.minValue);
      if (!Number.isFinite(minValue)) {
        return { ok: false, error: `"${questionText}" needs a minimum number to pass.` };
      }
      value.push({ id, questionText, questionType, required, expectedYesNo: null, minValue });
    }
  }

  return { ok: true, value };
}

type DB = SupabaseClient<Database>;

/**
 * Writes a job posting's screening questions, reconciling against whatever
 * already exists rather than a blind delete-and-reinsert.
 *
 * ── WHY NOT "DELETE ALL, THEN REINSERT THE SUBMITTED SET" ─────────────────
 *
 * That's exactly the pattern `updateJobAction` already uses for `skills` —
 * safe there because nothing references a skill string by id. It is NOT
 * safe here: `application_screening_answers.question_id` is `ON DELETE
 * CASCADE` (0171), so deleting a question a candidate has already answered
 * would silently destroy their real, submitted self-assessment the next
 * time an employer saves an UNRELATED edit to the job (fixing a typo in the
 * description, say) — the exact "job editing quietly loses real candidate
 * data" bug this function exists to not have. Instead:
 *
 *   - a submitted row WITH an id updates that row in place (answers already
 *     tied to it survive; their own `passed` may now read against a since-
 *     edited threshold — an accepted, narrow tradeoff of editing a live
 *     question, not something this pass tries to reconcile further)
 *   - a submitted row with NO id is a genuinely new question, inserted fresh
 *   - an existing row absent from the submitted set is a REMOVAL — allowed
 *     only if nobody has answered it yet; refused with a clear error
 *     otherwise, the same "clear inline error, not a silent drop" instinct
 *     readSalaryForm already applies to a malformed salary field.
 */
export async function reconcileScreeningQuestions(
  supabase: DB,
  jobPostingId: string,
  submitted: ScreeningQuestionInput[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: existing, error: loadErr } = await supabase
    .from("job_posting_screening_questions")
    .select("id, question_text")
    .eq("job_posting_id", jobPostingId);
  if (loadErr) return { ok: false, error: `Couldn't load existing screening questions: ${loadErr.message}` };

  const submittedIds = new Set(submitted.map((q) => q.id).filter((id): id is string => !!id));
  const removed = (existing ?? []).filter((row) => !submittedIds.has(row.id));

  if (removed.length > 0) {
    const removedIds = removed.map((r) => r.id);
    const { data: answered, error: answeredErr } = await supabase
      .from("application_screening_answers")
      .select("question_id")
      .in("question_id", removedIds);
    if (answeredErr) return { ok: false, error: `Couldn't check existing answers: ${answeredErr.message}` };

    const answeredQuestionIds = new Set((answered ?? []).map((a) => a.question_id));
    const blocked = removed.filter((r) => answeredQuestionIds.has(r.id));
    if (blocked.length > 0) {
      return {
        ok: false,
        error: `Can't remove "${blocked[0]!.question_text}" — at least one candidate has already answered it.`,
      };
    }

    const { error: deleteErr } = await supabase
      .from("job_posting_screening_questions")
      .delete()
      .in(
        "id",
        removed.map((r) => r.id),
      );
    if (deleteErr) return { ok: false, error: `Couldn't remove a screening question: ${deleteErr.message}` };
  }

  for (const [index, q] of submitted.entries()) {
    const row = {
      job_posting_id: jobPostingId,
      question_text: q.questionText,
      question_type: q.questionType,
      required: q.required,
      expected_yes_no: q.expectedYesNo,
      min_value: q.minValue,
      sort_order: index,
    };
    if (q.id) {
      const { error } = await supabase.from("job_posting_screening_questions").update(row).eq("id", q.id);
      if (error) return { ok: false, error: `Couldn't save "${q.questionText}": ${error.message}` };
    } else {
      const { error } = await supabase.from("job_posting_screening_questions").insert(row);
      if (error) return { ok: false, error: `Couldn't save "${q.questionText}": ${error.message}` };
    }
  }

  return { ok: true };
}
