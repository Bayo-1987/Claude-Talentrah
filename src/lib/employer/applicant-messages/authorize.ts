import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * Is this application one of THIS organisation's applicants on THIS job? Asked through the employer's OWN session, so the independent gates the applicants page uses
 * decide it, not a lookup that bypassed them: the job must be one the organisation owns, and `employer_job_applicants` (0125/0154, SECURITY DEFINER with its own
 * membership check and an applied-only predicate) must list the application. A foreign job, a foreign application, a bookmark and a made-up id all answer false.
 */
export async function isApplicantOfMyJob(
  supabase: SupabaseClient<Database>,
  { organizationId, jobId, applicationId }: { organizationId: string; jobId: string; applicationId: string },
): Promise<boolean> {
  const { data: job } = await supabase
    .from("job_postings")
    .select("id")
    .eq("id", jobId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!job) return false;

  const { data: applicants, error } = await supabase.rpc("employer_job_applicants", { p_job_posting_id: jobId });
  if (error) return false;
  return (applicants ?? []).some((a) => a.application_id === applicationId);
}
