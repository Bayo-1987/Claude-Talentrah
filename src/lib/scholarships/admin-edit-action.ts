"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin/require-admin";
import { recordAdminAction } from "@/lib/admin/audit";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { buildScholarshipEdit, isEditableStatus } from "./admin-edit";
import type { EditScholarshipState } from "./admin-edit-state";
import { deadlineNoteRuleMessage } from "./public-deadline-note";
import { manualScholarshipSchema } from "./schemas";

/**
 * Edit a scholarship listing (owner row, 8 Oct 2026). The gate is THE PERMISSION CHECK IN THIS ACTION (a Server Action is a POST endpoint of its own; the page guard protects the
 * page only). The form is parsed by the same schema as the add-by-hand form, the stored row is read, `buildScholarshipEdit` decides the update (a published listing whose content
 * changes goes back to pending), the write is conditional on the status that was read (two operators cannot both edit under a stale view), the edit is audit-logged against the
 * operator, and the operator is sent back to the queue.
 */
const COLUMNS =
  "id, moderation_status, provider, program_name, host_institution, degree_levels, field_tags, funding_type, funding_covers, eligibility_nationalities, eligibility_prior_degree, eligibility_age, eligibility_other, application_deadline, cycle_year, official_url, source_name, deadline_verified_at, deadline_note, moderation_note, dedup_fingerprint, last_checked_at";

export async function updateScholarshipAction(id: string, _prev: EditScholarshipState, formData: FormData): Promise<EditScholarshipState> {
  const operator = await requirePermission("scholarships");

  const parsed = manualScholarshipSchema.safeParse({
    provider: formData.get("provider"),
    programName: formData.get("programName"),
    hostInstitution: formData.get("hostInstitution"),
    degreeLevels: formData.getAll("degreeLevels"),
    fieldTags: formData.get("fieldTags"),
    fundingType: formData.get("fundingType"),
    fundingCovers: formData.get("fundingCovers"),
    eligibilityNationalities: formData.get("eligibilityNationalities"),
    eligibilityPriorDegree: formData.get("eligibilityPriorDegree"),
    eligibilityAge: formData.get("eligibilityAge"),
    eligibilityOther: formData.get("eligibilityOther"),
    applicationDeadline: formData.get("applicationDeadline"),
    cycleYear: formData.get("cycleYear"),
    officialUrl: formData.get("officialUrl"),
    sourceName: formData.get("sourceName") || undefined,
    deadlineNote: formData.get("deadlineNote"),
    reviewNote: formData.get("reviewNote"),
  });
  if (!parsed.success) {
    return { status: "error", error: "Check the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
  }

  const supabase = createServiceRoleClient();
  const { data: existing, error: readError } = await supabase.from("scholarships").select(COLUMNS).eq("id", id).maybeSingle();
  if (readError) {
    console.error("[admin-scholarships:edit] read failed", readError);
    return { status: "error", error: "Couldn't load that listing, so nothing was saved. Try again." };
  }
  if (!existing) return { status: "error", error: "That listing no longer exists." };
  if (!isEditableStatus(existing.moderation_status)) {
    return { status: "error", error: "This listing can't be edited: only pending and published listings can." };
  }

  const edit = buildScholarshipEdit({
    parsed: parsed.data,
    existing: existing as unknown as Parameters<typeof buildScholarshipEdit>[0]["existing"],
    operator: { adminId: operator.adminId, email: operator.email, displayName: operator.displayName },
    now: new Date().toISOString(),
  });
  if (edit.refusal) return { status: "error", error: "Check the highlighted fields.", fieldErrors: edit.refusal };

  const { data: written, error } = await supabase
    .from("scholarships")
    .update(edit.update as never)
    .eq("id", id)
    .eq("moderation_status", existing.moderation_status)
    .select("id");
  if (error) {
    console.error("[admin-scholarships:edit] write failed", error);
    const noteMessage = deadlineNoteRuleMessage(error.message);
    if (noteMessage) return { status: "error", error: "Check the highlighted fields.", fieldErrors: { deadlineNote: [noteMessage] } };
    return { status: "error", error: "Couldn't save that listing. The error is in the server log." };
  }
  if (!written?.length) {
    return { status: "error", error: "Someone else changed this listing while you were editing. Reload and try again." };
  }

  await recordAdminAction({
    identity: operator,
    action: "scholarship.edited",
    targetTable: "scholarships",
    targetId: id,
    detail: { program_name: parsed.data.programName, changed: edit.changed, returned_to_review: edit.returnedToReview },
  });

  revalidatePath("/admin/scholarships");
  // A published listing that went back to review must leave the public catalog now, not at the next cache expiry.
  if (edit.returnedToReview) revalidatePath("/scholarships");
  redirect("/admin/scholarships");
}
