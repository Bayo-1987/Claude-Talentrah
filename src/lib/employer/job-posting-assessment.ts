import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { ASSESSMENT_EXERCISE_BUCKET } from "./assessment-document";

/**
 * send-346 v2 — the shape the client editor produces, JSON-encoded into one
 * hidden input, the same convention screening-questions.ts already uses
 * for its own editor. `null` means "no assessment attached" (or "remove
 * the one that was there"), distinguished from an empty-but-present object
 * so the reconcile step below can tell "not touched" from "explicitly
 * cleared" the same way parseScreeningQuestionsForm's own hidden field
 * distinguishes an empty array from a missing one.
 *
 * The exercise FILES are deliberately not part of this shape — a File
 * can't travel through a hidden JSON input, so each one is uploaded
 * separately via /api/employer/job-assessment-exercise, which inserts a
 * `job_posting_assessment_files` row (send-364 — up to
 * MAX_ASSESSMENT_FILES of them, was a single `exercise_file_path` column
 * before this). This type only ever carries the plain-text fields.
 */
export interface JobPostingAssessmentInput {
  title: string;
  /** send-448 — optional: a link or an uploaded exercise file can carry the
   * actual content instead, so null means "nothing written," not invalid. */
  instructions: string | null;
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
  if (!title) return { ok: false, error: "The assessment needs a title." };

  // send-448 — optional, same "present-or-empty, both fine" treatment
  // exerciseLink already gets: a link or an uploaded exercise file can
  // already carry the actual content, so forcing separate written
  // instructions on top duplicated it with no way around that. `null`
  // (not `""`) represents "nothing written," matching exerciseLink's own
  // `rawLink || null` a few lines down and the column's own nullable
  // definition (0187) — deliberately not a second "empty means unset"
  // convention for the same table.
  const rawInstructions = typeof a.instructions === "string" ? a.instructions.trim() : "";
  const instructions = rawInstructions || null;

  const rawLink = typeof a.exerciseLink === "string" ? a.exerciseLink.trim() : "";
  if (rawLink && !isHttpUrl(rawLink)) {
    return { ok: false, error: "The assessment's link isn't a valid web address." };
  }
  const exerciseLink = rawLink || null;
  const required = a.required !== false;

  // send-448 — deliberately NOT blocking "title, no instructions, no
  // link" here, even though that combination currently leaves nothing
  // for a candidate to act on. This function has no visibility into
  // whether an exercise FILE is about to be attached — on Create, files
  // are staged separately (new-job-assessment-files-picker.tsx) and
  // uploaded only after this same save creates the posting/assessment
  // row; on Edit, today's flow is check the box, save once, THEN attach
  // a file. Blocking here would reject exactly that legitimate
  // file-only path, which this function structurally cannot distinguish
  // from a genuinely empty assessment. The same gap already exists
  // today in narrower form (an assessment saved with instructions but no
  // file yet, mid-way through that same two-step flow) — this send
  // widens the reachable window slightly but doesn't introduce the class
  // of problem.
  return { ok: true, value: { title, instructions, exerciseLink, required } };
}

type DB = SupabaseClient<Database>;

/**
 * Deletes every `job_posting_assessment_files` row (AND their storage
 * objects) for one assessment — the cross-table half of "a link and files
 * are alternatives, not both" that 0177's single-table CHECK constraint
 * used to enforce on its own before 0178 moved files into a child table
 * (see that migration's own header on why this is application code now,
 * not a constraint: Postgres can't CHECK across tables, and this repo's
 * existing stance for this exact rule is "self-reported, no server-side
 * hard block," matching `required`'s own treatment).
 *
 * Storage removal goes through the CALLER'S OWN client — 0177's "job
 * assessment exercises are deletable by the owning org" policy is what
 * authorises it, the same "caller's client, RLS is the real authority"
 * discipline every other write in this feature already follows. Best-
 * effort on the storage side: if a storage object is already gone (or the
 * remove call otherwise fails), the DB rows are still deleted — an orphaned
 * object with no DB row pointing at it is inert (nothing resolves a URL to
 * it), the opposite of a DB row pointing at a missing object.
 */
export async function clearAssessmentExerciseFiles(supabase: DB, assessmentId: string): Promise<void> {
  const { data: files } = await supabase
    .from("job_posting_assessment_files")
    .select("id, file_path")
    .eq("job_posting_assessment_id", assessmentId);

  if (!files || files.length === 0) return;

  await supabase.storage
    .from(ASSESSMENT_EXERCISE_BUCKET)
    .remove(files.map((f) => f.file_path))
    .catch(() => null);

  await supabase.from("job_posting_assessment_files").delete().eq("job_posting_assessment_id", assessmentId);
}

/**
 * The other direction of the same exclusivity rule: uploading a file is an
 * alternative to a link, not an addition — called by
 * /api/employer/job-assessment-exercise's own POST handler right after a
 * successful storage upload, kept here (exported, matched pair with
 * clearAssessmentExerciseFiles above) rather than left as an inline update
 * inside the route, specifically so both directions of the rule live in one
 * place and can both be tested the same way.
 */
export async function clearAssessmentExerciseLink(supabase: DB, assessmentId: string): Promise<void> {
  await supabase.from("job_posting_assessments").update({ exercise_link: null }).eq("id", assessmentId);
}

/**
 * Writes (or removes) a job posting's assessment, mirroring
 * reconcileScreeningQuestions' own shape: an existing row is updated in
 * place, a genuinely new one is inserted, and removal is refused once a
 * candidate has already responded — the same "clear inline error, not a
 * silent drop" instinct, and for the same reason: destroying a real
 * candidate submission's context as a side effect of an unrelated posting
 * edit would be worse than a blocked removal.
 *
 * `created` (send-449) is true ONLY on a genuine insert — the one moment
 * updateJobAction needs to know about, because it's the one moment a
 * client-staged exercise file (EditJobAssessmentFilesPicker) has a real
 * `job_posting_assessments.id` to attach to for the first time. An update
 * to an already-existing row reports `created: false` even though the
 * caller changed real fields, same as a no-op removal.
 */
export async function reconcileJobPostingAssessment(
  supabase: DB,
  jobPostingId: string,
  organizationId: string,
  createdBy: string,
  input: JobPostingAssessmentInput | null,
): Promise<{ ok: true; created: boolean } | { ok: false; error: string }> {
  const { data: existing, error: loadErr } = await supabase
    .from("job_posting_assessments")
    .select("id")
    .eq("job_posting_id", jobPostingId)
    .maybeSingle();
  if (loadErr) return { ok: false, error: `Couldn't load the existing assessment: ${loadErr.message}` };

  if (input === null) {
    if (!existing) return { ok: true, created: false };

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
    return { ok: true, created: false };
  }

  const row = {
    job_posting_id: jobPostingId,
    organization_id: organizationId,
    title: input.title,
    instructions: input.instructions,
    exercise_link: input.exerciseLink,
    required: input.required,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { error } = await supabase.from("job_posting_assessments").update(row).eq("id", existing.id);
    if (error) return { ok: false, error: `Couldn't save the assessment: ${error.message}` };

    // A newly-set link is an alternative to any uploaded files, not an
    // addition alongside them — this is the file-table half of the same
    // exclusivity rule the row write above can no longer enforce with a
    // CHECK constraint (see clearAssessmentExerciseFiles's own header).
    // Only runs when a link was actually SET: leaving the link blank must
    // not touch files an earlier edit already attached.
    if (input.exerciseLink) {
      await clearAssessmentExerciseFiles(supabase, existing.id);
    }
    return { ok: true, created: false };
  }

  // A genuinely new assessment can't have EXISTING files to clear
  // regardless of whether a link was set — but it CAN have files staged
  // client-side, waiting for exactly this id (send-449). created: true is
  // the caller's signal to trigger that upload.
  const { error } = await supabase.from("job_posting_assessments").insert({ ...row, created_by: createdBy });
  if (error) return { ok: false, error: `Couldn't save the assessment: ${error.message}` };
  return { ok: true, created: true };
}
