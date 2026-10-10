import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * Is this application one of THIS organisation's applicants on THIS job? Asked through the employer's OWN session, so the independent gates the applicants page uses
 * decide it, not a lookup that bypassed them: the job must be one the organisation owns, and `employer_job_applicants` (0125/0154, SECURITY DEFINER with its own
 * membership check and an applied-only predicate) must list the application. A foreign job, a foreign application, a bookmark and a made-up id all answer false.
 */
export async function isApplicantOfMyJob(
  supabase: SupabaseClient<Database>,
  ids: { organizationId: string; jobId: string; applicationId: string },
): Promise<boolean> {
  return (await findMyApplicant(supabase, ids)) !== null;
}

/** The same check, returning the applicant's name (what the page needs to greet them) or null. Never the email: employer_job_applicants does not return one. */
export async function findMyApplicant(
  supabase: SupabaseClient<Database>,
  { organizationId, jobId, applicationId }: { organizationId: string; jobId: string; applicationId: string },
): Promise<{ firstName: string | null; lastName: string | null; jobTitle: string } | null> {
  const { data: job } = await supabase
    .from("job_postings")
    .select("id, title")
    .eq("id", jobId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!job) return null;

  const { data: applicants, error } = await supabase.rpc("employer_job_applicants", { p_job_posting_id: jobId });
  if (error) return null;
  const applicant = (applicants ?? []).find((a) => a.application_id === applicationId);
  return applicant ? { firstName: applicant.first_name, lastName: applicant.last_name, jobTitle: job.title } : null;
}
