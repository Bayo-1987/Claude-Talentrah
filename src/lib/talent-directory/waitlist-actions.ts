"use server";

import { redirect } from "next/navigation";
import { requireEmployer } from "@/lib/employer/membership";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { joinTalentDirectoryWaitlist } from "./waitlist-runner";

/**
 * Join the Talent Directory waitlist. Free, and open to ANY member of the organisation (it spends nothing, unlike subscribing, which is
 * owner/admin only). The organisation comes from the caller's own session via requireEmployer(), never from the form.
 */
export async function joinTalentDirectoryWaitlistAction() {
  const context = await requireEmployer();
  try {
    await joinTalentDirectoryWaitlist(createServiceRoleClient(), {
      organizationId: context.organization.id,
      userId: context.userId,
    });
  } catch {
    redirect("/employer/talent-directory?error=" + encodeURIComponent("Something went wrong on our end. Try again."));
  }
  redirect("/employer/talent-directory?waitlist=joined");
}
