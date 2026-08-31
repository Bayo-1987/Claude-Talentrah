"use server";

import { revalidatePath } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requirePermission } from "@/lib/admin/require-admin";
import { recordAdminAction } from "@/lib/admin/audit";
import type { ModerationState } from "./state";

/**
 * The three moderation decisions, as Server Actions under an admin session.
 *
 * WHAT IS ACTUALLY NEW HERE, and it is the whole point of having done M1
 * first: every one of these records WHICH operator decided. The API routes
 * these are adapted from each hardcode a null with a comment explaining that a
 * shared secret proves "an operator" and not "which operator", and that
 * accepting a caller-supplied id would render a self-asserted claim as
 * attribution. Both were correct. `requirePermission(...)` returns an identity
 * the server established itself, from a session row it can revoke — so the id
 * written below is not a claim, and 0064 gives two of the three somewhere to
 * put it.
 *
 * It also answers a second question the old `requireAdmin()` did not: not just
 * WHO is deciding, but whether they may decide THIS. Each action names its own
 * permission, because a Server Action is reachable by POST without the page
 * that hosts it ever rendering — so the page guard protects the page, and only
 * this protects this.
 *
 * Every action also writes `admin_audit_log`. The column on the record answers
 * "who last touched this row"; the log answers "what did this operator do",
 * including the decisions whose target has since been deleted. Neither
 * replaces the other.
 *
 * THE STATE CHECKS STAY IN THE DATABASE. Each decision is one conditional
 * UPDATE whose WHERE clause carries the precondition, so two operators
 * clicking at once produce one state change and one refusal rather than two
 * writes racing. That is the `spendCredits` lesson (0035) applied to a queue
 * two people can genuinely have open at the same time — which, unlike a
 * credit balance, is the normal case for a moderation dashboard.
 */

/** Approve or reject a scholarship. */
export async function decideScholarshipAction(
  _prev: ModerationState,
  formData: FormData,
): Promise<ModerationState> {
  const admin = await requirePermission("scholarships");
  const id = String(formData.get("id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const note = String(formData.get("note") ?? "").trim();

  if (!id || (decision !== "verified" && decision !== "rejected")) {
    return { status: "error", message: "Pick approve or reject.", targetId: id };
  }
  if (decision === "rejected" && !note) {
    // A rejection with no reason is not a review: nobody can tell later
    // whether the listing was wrong or the reviewer was.
    return { status: "error", message: "A rejection needs a reason.", targetId: id };
  }

  const supabase = createServiceRoleClient();

  /*
   * THE WRITE HAPPENS IN THE DATABASE, permission-checked in the same
   * statement (0079). requirePermission above is still the gate a person hits;
   * this is the backstop under it, so a future code path that forgets the
   * guard cannot write either. The precondition — only a row still `pending` —
   * moved into the function with it, for the same reason it was in the
   * statement before: a listing another operator already decided must not be
   * re-decided by whoever clicks second.
   */
  const { data: res, error } = await supabase.rpc("admin_moderate_scholarship", {
    p_actor: admin.adminId,
    p_id: id,
    p_status: decision,
    p_note: note,
  });

  if (error) {
    console.error("[admin-moderation] scholarship", error);
    return { status: "error", message: "Something went wrong on our end.", targetId: id };
  }
  const row = res?.[0];
  if (!row?.ok) {
    return {
      status: "error",
      message:
        row?.reason === "not_authorised"
          ? "You do not have permission to review scholarships."
          : "Already decided by someone else — reload to see the current queue.",
      targetId: id,
    };
  }

  // Read back for the message and the audit detail. A separate read rather
  // than a returning-clause: the name is presentation, and widening the
  // function's return type to carry it would tie the guard to the copy.
  const { data } = await supabase
    .from("scholarships").select("program_name").eq("id", id).maybeSingle();
  const programName = data?.program_name ?? "that scholarship";

  await recordAdminAction({
    identity: admin,
    action: decision === "verified" ? "scholarship.approved" : "scholarship.rejected",
    targetTable: "scholarships",
    targetId: id,
    detail: { program_name: programName, note: note || null },
  });

  revalidatePath("/admin/scholarships");
  return {
    status: "success",
    targetId: id,
    message:
      decision === "verified"
        ? `Approved — “${programName}” is now in the public catalog.`
        : `Rejected — “${programName}” stays out of the catalog.`,
  };
}

/**
 * Remove a reported posting, or put it back.
 *
 * Restore lands in `closed`, never `open` — carried over from the API route
 * unchanged, and worth restating because it is the part an operator assumes
 * wrongly. Restoring says "this should not have been removed"; it does not say
 * "this job is live right now". An external posting reopens on the next ingest
 * run if its source still lists it, and an internal one is the employer's to
 * reopen. Restoring straight to `open` would re-advertise a job on the
 * strength of a moderation reversal.
 */
export async function decideJobPostingAction(
  _prev: ModerationState,
  formData: FormData,
): Promise<ModerationState> {
  const admin = await requirePermission("reported_postings");
  const id = String(formData.get("id") ?? "");
  const action = String(formData.get("action") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  if (!id || (action !== "remove" && action !== "restore")) {
    return { status: "error", message: "Pick remove or restore.", targetId: id };
  }
  if (!reason) {
    // Both directions. A removal with no reason leaves the employer nothing to
    // answer; a restore with no reason leaves no record of why a removal was
    // reversed, which is the only thing making a bad removal auditable.
    return { status: "error", message: "Both remove and restore need a reason.", targetId: id };
  }

  const supabase = createServiceRoleClient();

  /*
   * Both directions go through one database function (0079), which holds the
   * permission check and the state precondition in the same statement as the
   * write. The restore half also clears removed_at alongside status, because
   * preserve_job_posting_removal only lets a row leave `removed` when the two
   * move together — which is what stops the nightly ingest quietly un-removing
   * a scam listing.
   */
  const { data: res, error } = await supabase.rpc("admin_moderate_job_posting", {
    p_actor: admin.adminId,
    p_id: id,
    p_action: action,
    p_reason: reason,
  });

  if (error) {
    console.error("[admin-moderation] job posting", error);
    return { status: "error", message: "Something went wrong on our end.", targetId: id };
  }
  const res0 = res?.[0];
  if (!res0?.ok) {
    return {
      status: "error",
      message:
        res0?.reason === "not_authorised"
          ? "You do not have permission to moderate reported postings."
          : action === "remove"
            ? "Already removed — reload to see the current queue."
            : "That posting isn't removed, so there's nothing to restore.",
      targetId: id,
    };
  }

  const { data: posting } = await supabase
    .from("job_postings").select("title, company_name").eq("id", id).maybeSingle();
  const title = posting?.title ?? "that posting";

  await recordAdminAction({
    identity: admin,
    action: action === "remove" ? "job_posting.removed" : "job_posting.restored",
    targetTable: "job_postings",
    targetId: id,
    detail: { title, company: posting?.company_name ?? null, reason },
  });

  revalidatePath("/admin/reports");
  return {
    status: "success",
    targetId: id,
    message:
      action === "remove"
        ? `Removed “${title}”. The owning organisation still sees it and the reason; the public does not.`
        : `Restored to closed, not open — it reopens on the next ingest run only if its source still lists it.`,
  };
}

/**
 * Approve or reject an ad campaign.
 *
 * APPROVAL DOES NOT START IT. `set_ad_campaign_review` lands an approved
 * campaign in `paused_by_employer`, not `active`. Approval says the ad is
 * acceptable; it says nothing about whether the wallet can pay for it. Going
 * live is `resume_ad_campaign`, which charges — so there is exactly one path
 * from not-running to running and it always costs money. Two paths would be
 * two places to forget the charge.
 *
 * This is the one of the three whose attribution column already existed:
 * `ad_campaigns.reviewed_by` has been an FK to `profiles` all along, and the
 * RPC has always taken `p_reviewer_id`. Only the caller was passing null.
 */
export async function decideCampaignAction(
  _prev: ModerationState,
  formData: FormData,
): Promise<ModerationState> {
  const admin = await requirePermission("ad_campaigns");
  const id = String(formData.get("id") ?? "");
  const approve = String(formData.get("decision") ?? "") === "approve";
  const note = String(formData.get("note") ?? "").trim();

  if (!id) return { status: "error", message: "Missing campaign.", targetId: id };
  if (!approve && !note) {
    return {
      status: "error",
      message: "A rejection needs a note explaining what to change.",
      targetId: id,
    };
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("set_ad_campaign_review", {
    p_campaign_id: id,
    p_approve: approve,
    p_reviewer_id: admin.adminId,
    // Nullable in SQL; typegen renders a parameter without a DEFAULT as
    // non-optional and so over-narrows it.
    p_note: (note || null) as unknown as string,
  });

  if (error) {
    console.error("[admin-moderation] campaign", error);
    return { status: "error", message: "Something went wrong on our end.", targetId: id };
  }
  if (!data) {
    // The RPC's own WHERE carries the precondition, so a null return means it
    // was decided by someone else between the render and the click.
    return {
      status: "error",
      message: "That campaign isn't awaiting review any more — reload.",
      targetId: id,
    };
  }

  await recordAdminAction({
    identity: admin,
    action: approve ? "ad_campaign.approved" : "ad_campaign.rejected",
    targetTable: "ad_campaigns",
    targetId: id,
    detail: { resulting_status: data, note: note || null },
  });

  revalidatePath("/admin/campaigns");
  return {
    status: "success",
    targetId: id,
    message: approve
      ? "Approved. It stays paused until the employer resumes it, which is when it first charges."
      : "Rejected.",
  };
}

/**
 * Move one piece of feedback through triage.
 *
 * The odd one out among the four, because there is nothing to approve: a bug
 * report is not right or wrong, it is read or unread. So the states are about
 * whether anyone is going to act, and `declined` exists so that "we read this
 * and are not acting on it" has somewhere honest to go — without it an
 * operator either marks it resolved, which makes the word mean two things, or
 * leaves it open forever.
 *
 * `triaged_by` is set on every transition rather than only the first, so the
 * column answers "who put it in the state it is in now" rather than "who
 * touched it first". `admin_audit_log` keeps the whole chain, which is where
 * the earlier operators remain visible.
 *
 * There is no path back to `new`. Un-triaging would erase the one thing the
 * column is for; an operator who changes their mind moves it to another
 * decided state, and the log records both.
 */
export async function decideFeedbackAction(
  _prev: ModerationState,
  formData: FormData,
): Promise<ModerationState> {
  const admin = await requirePermission("feedback");
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("decision") ?? "");
  const note = String(formData.get("note") ?? "").trim();

  const ALLOWED = ["in_review", "resolved", "declined"] as const;
  type Allowed = (typeof ALLOWED)[number];
  if (!id || !(ALLOWED as readonly string[]).includes(status)) {
    return { status: "error", message: "Pick a triage state.", targetId: id };
  }
  if (status === "declined" && !note) {
    // Declining without saying why leaves nothing for the next operator to
    // check, and nothing to answer if the person follows up.
    return { status: "error", message: "Declining needs a reason.", targetId: id };
  }

  const supabase = createServiceRoleClient();

  // Permission-checked in the same statement as the write (0079).
  const { data: res, error } = await supabase.rpc("admin_triage_feedback", {
    p_actor: admin.adminId,
    p_id: id,
    p_status: status,
    p_note: note,
  });

  if (error) {
    console.error("[admin-moderation] feedback", error);
    return { status: "error", message: "Something went wrong on our end.", targetId: id };
  }
  const row = res?.[0];
  if (!row?.ok) {
    return {
      status: "error",
      message:
        row?.reason === "not_authorised"
          ? "You do not have permission to triage feedback."
          : "Already in that state — reload to see the current queue.",
      targetId: id,
    };
  }

  await recordAdminAction({
    identity: admin,
    action: `feedback.${status}`,
    targetTable: "feedback",
    targetId: id,
    // The note, not the message. The audit log is read by operators and the
    // feedback text is the user's words — duplicating it into a second table
    // widens where those words live for no gain.
    detail: { note: note || null },
  });

  revalidatePath("/admin/feedback");
  const LABEL: Record<string, string> = {
    in_review: "Marked in review.",
    resolved: "Marked resolved.",
    declined: "Declined, with your reason recorded.",
  };
  return { status: "success", targetId: id, message: LABEL[status] };
}
