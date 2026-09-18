import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * send-346 v2 — the shape the client editor produces, JSON-encoded into one
 * hidden input, the same convention screening-questions.ts already uses
 * for its own editor. `null` means "no assessment attached" (or "remove
 * the one that was there"), distinguished from an empty-but-present object
 * so the reconcile step below can tell "not touched" from "explicitly
 * cleared" the same way parseScreeningQuestionsForm's own hidden field
 * distinguishes an empty array from a missing one.
 *
 * The exercise FILE is deliberately not part of this shape — a File can't
 * travel through a hidden JSON input, so it's uploaded separately via
 * /api/employer/job-assessment-exercise, which writes exercise_file_path
 * directly. This type only ever carries the plain-text fields.
 */
export interface JobPostingAssessmentInput {
  title: string;
  instructions: string;
  exerciseLink: string | null;
  required: boolean;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Reads and validates the `jobPostingAssessment` hidden JSON input.
 *
 * Never trusted as-is, same stance parseScreeningQuestionsForm already
 * takes for its own sibling field.
 */
export function parseJobPostingAssessmentForm(
  form: FormData,
): { ok: true; value: JobPostingAssessmentInput | null } | { ok: false; error: string } {
  const raw = form.get("jobPostingAssessment");
  if (!raw || typeof raw !== "string" || raw.trim() === "") return { ok: true, value: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "The assessment was submitted in an unreadable format." };
  }
  if (parsed === null) return { ok: true, value: null };
  if (typeof parsed !== "object") {
    return { ok: false, error: "The assessment was submitted in an unreadable format." };
  }

  const a = parsed as Record<string, unknown>;
  const title = typeof a.title === "string" ? a.title.trim() : "";
  const instructions = typeof a.instructions === "string" ? a.instructions.trim() : "";
  if (!title) return { ok: false, error: "The assessment needs a title." };
  if (!instructions) return { ok: false, error: "The assessment needs instructions." };

  const rawLink = typeof a.exerciseLink === "string" ? a.exerciseLink.trim() : "";
  if (rawLink && !isHttpUrl(rawLink)) {
    return { ok: false, error: "The assessment's link isn't a valid web address." };
  }
  const exerciseLink = rawLink || null;
  const required = a.required !== false;

  return { ok: true, value: { title, instructions, exerciseLink, required } };
}

type DB = SupabaseClient<Database>;

/**
 * Writes (or removes) a job posting's assessment, mirroring
 * reconcileScreeningQuestions' own shape: an existing row is updated in
 * place, a genuinely new one is inserted, and removal is refused once a
 * candidate has already responded — the same "clear inline error, not a
 * silent drop" instinct, and for the same reason: destroying a real
 * candidate submission's context as a side effect of an unrelated posting
 * edit would be worse than a blocked removal.
 */
export async function reconcileJobPostingAssessment(
  supabase: DB,
  jobPostingId: string,
  organizationId: string,
  createdBy: string,
  input: JobPostingAssessmentInput | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: existing, error: loadErr } = await supabase
    .from("job_posting_assessments")
    .select("id")
    .eq("job_posting_id", jobPostingId)
    .maybeSingle();
  if (loadErr) return { ok: false, error: `Couldn't load the existing assessment: ${loadErr.message}` };

  if (input === null) {
    if (!existing) return { ok: true };

    const { count, error: countErr } = await supabase
      .from("application_assessment_submissions")
      .select("id", { count: "exact", head: true })
      .eq("job_posting_id", jobPostingId);
    if (countErr) return { ok: false, error: `Couldn't check existing submissions: ${countErr.message}` };
    if ((count ?? 0) > 0) {
      return {
        ok: false,
        error: "Can't remove the assessment — at least one candidate has already responded to it.",
      };
    }

    const { error: deleteErr } = await supabase.from("job_posting_assessments").delete().eq("id", existing.id);
    if (deleteErr) return { ok: false, error: `Couldn't remove the assessment: ${deleteErr.message}` };
    return { ok: true };
  }

  const row = {
    job_posting_id: jobPostingId,
    organization_id: organizationId,
    title: input.title,
    instructions: input.instructions,
    exercise_link: input.exerciseLink,
    // A newly-set link is an alternative to an uploaded file, not an
    // addition alongside one — clearing exercise_file_path here is what
    // keeps the table's own mutual-exclusivity CHECK constraint satisfied
    // when an employer switches from "uploaded a file" to "pasted a link"
    // in one edit.
    ...(input.exerciseLink ? { exercise_file_path: null } : {}),
    required: input.required,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { error } = await supabase.from("job_posting_assessments").update(row).eq("id", existing.id);
    if (error) return { ok: false, error: `Couldn't save the assessment: ${error.message}` };
  } else {
    const { error } = await supabase
      .from("job_posting_assessments")
      .insert({ ...row, created_by: createdBy });
    if (error) return { ok: false, error: `Couldn't save the assessment: ${error.message}` };
  }

  return { ok: true };
}
