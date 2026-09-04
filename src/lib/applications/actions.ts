"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { loadJobSnapshot } from "./job-snapshot";
import { logCountryDefaultEvent, type CountryState } from "@/lib/jobs/country-events";

async function getAuthedUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  return { supabase, userId: user.id };
}

/** Heart icon: saves a job, or un-saves it if it's only ever been saved (not applied further). */
export async function toggleSaveAction(jobId: string) {
  const { supabase, userId } = await getAuthedUserId();

  const { data: existing } = await supabase
    .from("applications")
    .select("id, stage")
    .eq("user_id", userId)
    .eq("job_posting_id", jobId)
    .maybeSingle();

  if (!existing) {
    // Snapshotted at creation (src/lib/applications/job-snapshot.ts) so this
    // row survives job_posting_id being deleted or nulled out later — see
    // that module's header for why.
    const snapshot = await loadJobSnapshot(supabase, jobId);
    await supabase.from("applications").insert({
      user_id: userId,
      job_posting_id: jobId,
      stage: "saved",
      source: "manual",
      manual_job_snapshot: snapshot,
    });
  } else if (existing.stage === "saved") {
    await supabase.from("applications").delete().eq("id", existing.id);
  }

  revalidatePath("/jobs");
  /*
   * The detail route as well. `revalidatePath("/jobs")` refreshes that exact
   * path only, so before this a Save made from /jobs/<id> left the button on
   * that page still reading "Save" until a hard reload — the state changed and
   * the page it changed on did not.
   */
  revalidatePath("/jobs/[id]", "page");
}

/**
 * Internal jobs: applies in-app using the user's base resume.
 *
 * `countryState` is Stage 12 instrumentation only ("kept"/"cleared"/"none" —
 * see src/lib/jobs/country-events.ts) — bound in from whichever page rendered
 * the Apply button, the same way `jobId` already is. It never gates or
 * changes what this action does; a logging failure inside it is swallowed by
 * logCountryDefaultEvent itself and cannot fail the apply.
 */
export async function applyInAppAction(jobId: string, countryState: CountryState) {
  const { supabase, userId } = await getAuthedUserId();

  const { data: baseResume, error: baseResumeError } = await supabase
    .from("resumes")
    .select("id")
    .eq("user_id", userId)
    .eq("is_base", true)
    .maybeSingle();

  // A missing resume is a legitimate state (resume_id just stays null below)
  // — a query error is not, and applying anyway would silently record the
  // wrong thing (QA audit bug #1). Fail loudly instead.
  if (baseResumeError) {
    throw new Error(`Couldn't look up your resume: ${baseResumeError.message}`);
  }

  const [{ data: existing }, snapshot] = await Promise.all([
    supabase
      .from("applications")
      .select("id")
      .eq("user_id", userId)
      .eq("job_posting_id", jobId)
      .maybeSingle(),
    loadJobSnapshot(supabase, jobId),
  ]);

  const payload = {
    user_id: userId,
    job_posting_id: jobId,
    resume_id: baseResume?.id ?? null,
    stage: "applied" as const,
    source: "internal_apply" as const,
    applied_at: new Date().toISOString(),
    // See src/lib/applications/job-snapshot.ts — kept fresh on update too,
    // not just the first insert, so the snapshot never falls behind the
    // real posting while it still exists.
    manual_job_snapshot: snapshot,
  };

  if (existing) {
    await supabase.from("applications").update(payload).eq("id", existing.id);
  } else {
    await supabase.from("applications").insert(payload);
  }

  await logCountryDefaultEvent({ userId, eventType: "apply", countryState, jobPostingId: jobId });

  revalidatePath("/jobs");
  /*
   * The detail route as well. `revalidatePath("/jobs")` refreshes that exact
   * path only, so before this a Save made from /jobs/<id> left the button on
   * that page still reading "Save" until a hard reload — the state changed and
   * the page it changed on did not.
   */
  revalidatePath("/jobs/[id]", "page");
  revalidatePath("/tracker");
}

/**
 * External jobs: the actual application happens on the source site; this
 * just logs it. `countryState` — see applyInAppAction's own header.
 */
export async function markAppliedExternallyAction(jobId: string, countryState: CountryState) {
  const { supabase, userId } = await getAuthedUserId();

  const [{ data: existing }, snapshot] = await Promise.all([
    supabase
      .from("applications")
      .select("id")
      .eq("user_id", userId)
      .eq("job_posting_id", jobId)
      .maybeSingle(),
    loadJobSnapshot(supabase, jobId),
  ]);

  const payload = {
    user_id: userId,
    job_posting_id: jobId,
    stage: "applied" as const,
    source: "manual" as const,
    applied_at: new Date().toISOString(),
    manual_job_snapshot: snapshot,
  };

  if (existing) {
    await supabase.from("applications").update(payload).eq("id", existing.id);
  } else {
    await supabase.from("applications").insert(payload);
  }

  await logCountryDefaultEvent({ userId, eventType: "apply", countryState, jobPostingId: jobId });

  revalidatePath("/jobs");
  /*
   * The detail route as well. `revalidatePath("/jobs")` refreshes that exact
   * path only, so before this a Save made from /jobs/<id> left the button on
   * that page still reading "Save" until a hard reload — the state changed and
   * the page it changed on did not.
   */
  revalidatePath("/jobs/[id]", "page");
  revalidatePath("/tracker");
}
