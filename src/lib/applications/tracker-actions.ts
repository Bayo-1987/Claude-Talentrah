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

/**
 * Saving notes, with the write actually checked.
 *
 * This was `await supabase.from(...).update(...)` with no `.select()`, no
 * error check and no row count — the shape that cannot report anything. A
 * Supabase update that is REFUSED does not throw; it resolves with an
 * `error`. So every possible failure here — a policy denial, a lost session, a
 * deleted row, a constraint — looked exactly like success, and the page
 * revalidated to show the old value as though that were the saved one.
 *
 * WHAT I COULD AND COULD NOT ESTABLISH. The reported symptom — Save does
 * nothing — did NOT reproduce against the seeded account: the note persisted
 * through save, revalidate and a full reload. Three candidate causes were
 * checked against production directly and all are clear: the `applications`
 * policy is owner-only for ALL and correct; every column including `notes`
 * carries an UPDATE grant to `authenticated`; and the 0037 terminal-stage
 * trigger early-returns when `old.stage is not distinct from new.stage`, so a
 * notes-only edit on a hired application is not blocked by it either.
 *
 * So this is not a diagnosis, and it is deliberately not written as one. It is
 * the missing instrument: whatever is failing for a real user now raises
 * instead of vanishing, and the next report arrives with a message attached.
 *
 * Worth knowing while reading a future report: this form gives NO success
 * feedback of any kind. It re-renders the textarea from `defaultValue`, so a
 * save that worked perfectly is visually identical to one that did nothing.
 * "Save does nothing" is what a working save also looks like.
 */
export async function updateNotesAction(applicationId: string, formData: FormData) {
  const { supabase, userId } = await getAuthedUserId();
  const notes = String(formData.get("notes") ?? "").trim();

  const { data: updated, error } = await supabase
    .from("applications")
    .update({ notes: notes || null })
    .eq("id", applicationId)
    .eq("user_id", userId)
    .select("id");

  if (error) {
    throw new Error(`Couldn't save those notes: ${error.message}`);
  }

  // Zero rows is not an error and not a success: the entry was deleted, or it
  // was never this user's. Same handling as updateStageAction — revalidate so
  // the page shows what is actually there rather than leaving a textarea
  // asserting otherwise.
  if (!updated?.length) {
    revalidatePath("/tracker");
    return;
  }

  revalidatePath("/tracker");
}
