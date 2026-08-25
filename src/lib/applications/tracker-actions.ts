"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Enums } from "@/lib/supabase/types";

async function getAuthedUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  return { supabase, userId: user.id };
}

/** A job applied to outside Talentrah — no job_postings row, just enough to render a card. */
export async function addManualEntryAction(formData: FormData) {
  const { supabase, userId } = await getAuthedUserId();

  const companyName = String(formData.get("companyName") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  const stage = String(formData.get("stage") ?? "saved") as Enums<"application_stage">;
  const notes = String(formData.get("notes") ?? "").trim();

  if (!companyName || !title) {
    throw new Error("Company and title are required.");
  }

  await supabase.from("applications").insert({
    user_id: userId,
    job_posting_id: null,
    manual_job_snapshot: {
      companyName,
      title,
      url: url || undefined,
      location: location || undefined,
    },
    stage,
    source: "manual",
    notes: notes || null,
    applied_at: stage === "saved" ? null : new Date().toISOString(),
  });

  revalidatePath("/tracker");
}

/**
 * Changing to "hired" is a deliberate, distinct action (build-prompt §2.5,
 * M7 spec §3) — the confirmation happens client-side (StageSelect) before
 * this ever gets called; this action just needs applied_at backfilled if a
 * manual entry skips straight from "saved" to a later stage without ever
 * going through "applied".
 */
export async function updateStageAction(applicationId: string, formData: FormData) {
  const { supabase, userId } = await getAuthedUserId();
  const stage = String(formData.get("stage") ?? "") as Enums<"application_stage">;
  const expectedStage = String(formData.get("expectedStage") ?? "");

  const { data: existing } = await supabase
    .from("applications")
    .select("applied_at, stage")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .single();

  /*
   * Optimistic lock on the stage the page was rendered with.
   *
   * Without it this is a read-then-write: two near-simultaneous changes (a
   * double-click before the select disables, or two open tabs) both read the
   * same starting stage and the later UPDATE wins outright — while
   * `applications_log_stage_change` still records BOTH as history, so the
   * stage-history string ends up describing a transition the row no longer
   * reflects.
   *
   * `expectedStage` comes from the rendered form. Falling back to the value
   * just read keeps older callers working, but that fallback is the racy path
   * and every caller in the app sends it.
   */
  const guardStage = (expectedStage || existing?.stage) as
    | Enums<"application_stage">
    | undefined;

  let query = supabase
    .from("applications")
    .update({
      stage,
      applied_at: existing?.applied_at ?? (stage === "saved" ? null : new Date().toISOString()),
    })
    .eq("id", applicationId)
    .eq("user_id", userId);
  if (guardStage) query = query.eq("stage", guardStage);

  const { data: updated, error } = await query.select("id");

  if (error) {
    // The stage-transition trigger (0037) raises check_violation when a hired
    // application is moved anywhere but archived. Surface it as itself rather
    // than as a generic failure.
    throw new Error(
      error.code === "23514" || /hired application/.test(error.message)
        ? "A hired application can only be archived."
        : `Couldn't update that application: ${error.message}`,
    );
  }

  // Zero rows means the guard didn't match: someone else already moved this
  // entry, or it was deleted in another tab. Revalidating shows the truth
  // instead of leaving a stale select claiming otherwise.
  if (!updated?.length) {
    revalidatePath("/tracker");
    return;
  }

  revalidatePath("/tracker");

  // M8's referral prompt hooks off this exact transition (build-prompt §2.5,
  // M8 spec §2/§5) — redirecting with the application id lets the Tracker
  // page show a one-time, personalized banner rather than a disruptive
  // interstitial. The credit-ledger side of "Hired" (if this application was
  // itself how the referred user got activated) is handled independently by
  // the applications_check_activation DB trigger — this redirect is purely
  // about prompting *this* user to refer someone, not about them having been
  // referred themselves.
  if (stage === "hired") {
    redirect(`/tracker?justHired=${applicationId}`);
  }
}

export async function updateNotesAction(applicationId: string, formData: FormData) {
  const { supabase, userId } = await getAuthedUserId();
  const notes = String(formData.get("notes") ?? "").trim();

  await supabase
    .from("applications")
    .update({ notes: notes || null })
    .eq("id", applicationId)
    .eq("user_id", userId);

  revalidatePath("/tracker");
}
