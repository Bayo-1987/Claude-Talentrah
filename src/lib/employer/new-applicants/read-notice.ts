import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isNoticeMode, type NoticeMode } from "./notice-mode";

/**
 * A person's current new-applicant email setting ('instant' when none is recorded: it is the default). Lives outside the "use server" actions file on purpose: anything exported from there is a
 * public endpoint, and this takes a user id.
 */
/**
 * "N new" per job for the Jobs Posted badge (0259). It must NEVER break the page: if the function is missing (not applied yet), refused, or the call itself throws, the answer is an empty map and the badge is simply absent.
 */
export async function loadNewApplicantCounts(
  supabase: { rpc: (fn: "employer_new_applicant_counts", args: { p_organization_id: string }) => PromiseLike<{ data: Array<{ job_posting_id: string; new_count: number }> | null; error: { message: string } | null }> },
  organizationId: string,
): Promise<Map<string, number>> {
  try {
    const { data, error } = await supabase.rpc("employer_new_applicant_counts", { p_organization_id: organizationId });
    if (error) {
      console.warn(`[new-applicants] no "N new" badges: ${error.message}`);
      return new Map();
    }
    return new Map((data ?? []).map((row) => [row.job_posting_id, Number(row.new_count)]));
  } catch (error) {
    console.warn(`[new-applicants] no "N new" badges: ${error instanceof Error ? error.message : "unknown error"}`);
    return new Map();
  }
}

export async function readNewApplicantNotice(userId: string): Promise<NoticeMode> {
  const { data } = await createServiceRoleClient().from("email_preferences").select("new_applicant_notice").eq("user_id", userId).maybeSingle();
  return isNoticeMode(data?.new_applicant_notice) ? data.new_applicant_notice : "instant";
}
