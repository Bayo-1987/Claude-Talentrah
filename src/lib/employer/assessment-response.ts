import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { findMyApplicant } from "@/lib/employer/applicant-messages/authorize";
import { ASSESSMENT_SUBMISSION_BUCKET } from "@/lib/employer/assessment-document";

/** A response file link lives for one hour: long enough to read the page, short enough that a copied link soon stops working. */
export const RESPONSE_FILE_LINK_SECONDS = 3600;

export interface AssessmentResponseView {
  responseText: string | null;
  responseLink: string | null;
  submittedAt: string;
  responseFiles: { url: string | null; originalFilename: string }[];
}

export type AssessmentResponseResult =
  /** Not this organisation's applicant on this job (a foreign job, a foreign or made-up application, a bookmark): the page answers not-found, never a hint that it exists elsewhere. */
  | { status: "not_found" }
  /** Their own applicant, but the job has no assessment. */
  | { status: "no_assessment"; applicantName: string; jobTitle: string }
  /** Their own applicant on a job with an assessment, who has not submitted a response. */
  | { status: "no_submission"; applicantName: string; jobTitle: string }
  | { status: "ok"; applicantName: string; jobTitle: string; submission: AssessmentResponseView };

/**
 * The applicant's assessment response, for the in-page viewer (ASSESSMENT-VIEWER-1). Read ONLY through the employer's OWN session, so every gate that guards the other applicant pages decides here too:
 *
 * 1. OWNERSHIP, in `findMyApplicant`: the job is one `organizationId` (from `requireEmployer()`, the caller's own membership) owns, AND `employer_job_applicants` (SECURITY DEFINER, with its own membership
 *    check) lists THIS application on THIS job. Job, application and organisation are asked together; anything else is `not_found`.
 * 2. The assessment and the submission are then read with the job id AND the application id in the same filters, through the same session (row security on both tables is the org-membership policy),
 *    so a submission can only come back for this application on this job.
 *
 * FILE LINKS are made only AFTER both of the above (an applicant that is not the organisation's own returns `not_found` before any storage call), as signed URLs of RESPONSE_FILE_LINK_SECONDS; the private
 * bucket has no public URL. It returns no email, phone or other personal data: only the applicant's name (what the applicants list already shows), the job title, and the response itself.
 */
export async function loadAssessmentResponse(
  supabase: SupabaseClient<Database>,
  ids: { organizationId: string; jobId: string; applicationId: string },
): Promise<AssessmentResponseResult> {
  const applicant = await findMyApplicant(supabase, ids);
  if (!applicant) return { status: "not_found" };
  const applicantName = [applicant.firstName, applicant.lastName].filter(Boolean).join(" ") || "this applicant";
  const base = { applicantName, jobTitle: applicant.jobTitle };

  const { data: assessment } = await supabase.from("job_posting_assessments").select("id").eq("job_posting_id", ids.jobId).maybeSingle();
  if (!assessment) return { status: "no_assessment", ...base };

  const { data: submission } = await supabase
    .from("application_assessment_submissions")
    .select("id, response_text, response_link, submitted_at")
    .eq("application_id", ids.applicationId)
    .eq("job_posting_id", ids.jobId)
    .maybeSingle();
  if (!submission) return { status: "no_submission", ...base };

  const { data: fileRows } = await supabase
    .from("application_assessment_response_files")
    .select("file_path, original_filename")
    .eq("application_assessment_submission_id", submission.id)
    .order("created_at", { ascending: true });

  const responseFiles: AssessmentResponseView["responseFiles"] = [];
  for (const row of fileRows ?? []) {
    const { data: signed, error } = await supabase.storage.from(ASSESSMENT_SUBMISSION_BUCKET).createSignedUrl(row.file_path, RESPONSE_FILE_LINK_SECONDS);
    if (error) console.error(`[assessment-viewer] could not sign ${row.file_path}:`, error.message);
    responseFiles.push({ url: error || !signed ? null : signed.signedUrl, originalFilename: row.original_filename });
  }

  return {
    status: "ok",
    ...base,
    submission: { responseText: submission.response_text, responseLink: submission.response_link, submittedAt: submission.submitted_at, responseFiles },
  };
}
