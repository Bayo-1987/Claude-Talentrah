"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireEmployer } from "@/lib/employer/membership";
import { isNoticeMode, type NoticeMode } from "@/lib/employer/new-applicants/notice-mode";

export type NoticeResult = { ok: true; mode: NoticeMode } | { ok: false; error: string };

/**
 * How the signed-in employer wants to hear about new applicants (0254): instant, daily digest or off. email_preferences is service-role only (0083), so the write happens here with the service role,
 * and ONLY for the caller's own row: the user id comes from their session, never from the request, and the caller must belong to an organisation (requireEmployer). A value that is not one of the three
 * is refused before anything is written.
 */
export async function setNewApplicantNoticeAction(mode: string): Promise<NoticeResult> {
  if (!isNoticeMode(mode)) return { ok: false, error: "Choose instant, daily digest or off." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in again to change this." };
  await requireEmployer();

  const { data, error } = await createServiceRoleClient()
    .from("email_preferences")
    .update({ new_applicant_notice: mode })
    .eq("user_id", user.id)
    .select("user_id");
  if (error || !data || data.length === 0) {
    console.error("[new-applicant-notice] could not save the setting:", error?.message ?? "no preference row");
    return { ok: false, error: "Couldn't save that. Try again." };
  }
  return { ok: true, mode };
}
