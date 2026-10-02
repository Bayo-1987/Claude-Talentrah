import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * The seeker's own stored assessment submission for an application, with the names of its stored files (application ->
 * submission -> response files). Read through the SESSION client: RLS lets the candidate read their own submission and
 * its files ("candidate or owning org can read ..."), so no service role and no schema change is needed.
 *
 * `null` when the application has no submission row (it was made without an assessment).
 */
export async function fetchStoredSubmission(
  supabase: Supabase,
  applicationId: string,
): Promise<{ fileNames: string[] } | null> {
  const { data } = await supabase
    .from("application_assessment_submissions")
    .select("id, application_assessment_response_files(original_filename)")
    .eq("application_id", applicationId)
    .maybeSingle();
  if (!data) return null;
  const files = (data.application_assessment_response_files ?? []) as Array<{ original_filename: string }>;
  return { fileNames: files.map((f) => f.original_filename) };
}
