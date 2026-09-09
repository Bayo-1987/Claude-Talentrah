"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
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
    const { error } = await supabase.from("applications").insert({
      user_id: userId,
      job_posting_id: jobId,
      stage: "saved",
      source: "manual",
      manual_job_snapshot: snapshot,
    });
    // A rejected insert resolves with `error`, it does not throw — checked,
    // per this repo's own standing rule (CLAUDE.md), because the alternative
    // is a Save click that reports success over a row that was never
    // written.
    if (error) throw new Error(`Couldn't save this job: ${error.message}`);
  } else if (existing.stage === "saved") {
    const { error } = await supabase.from("applications").delete().eq("id", existing.id);
    if (error) throw new Error(`Couldn't un-save this job: ${error.message}`);
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

  // Three-way parallel: none of these depend on either of the others — the
  // base-resume lookup used to run before this Promise.all for no reason,
  // making a click on Apply pay for three round-trips in sequence (1-then-2)
  // instead of the one this button's own CTA-latency fix (Button/IconButton
  // now show a real pending state via useFormStatus) still can't hide.
  const [{ data: baseResume, error: baseResumeError }, { data: existing }, snapshot] = await Promise.all([
    supabase.from("resumes").select("id").eq("user_id", userId).eq("is_base", true).maybeSingle(),
    supabase
      .from("applications")
      .select("id")
      .eq("user_id", userId)
      .eq("job_posting_id", jobId)
      .maybeSingle(),
    loadJobSnapshot(supabase, jobId),
  ]);

  // A missing resume is a legitimate state (resume_id just stays null below)
  // — a query error is not, and applying anyway would silently record the
  // wrong thing (QA audit bug #1). Fail loudly instead.
  if (baseResumeError) {
    throw new Error(`Couldn't look up your resume: ${baseResumeError.message}`);
  }

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

  // A rejected insert/update resolves with `error`, it does not throw —
  // checked, per this repo's own standing rule (CLAUDE.md), because the
  // alternative is an Apply click that reports success over a row that was
  // never written, which is exactly indistinguishable from a real apply
  // until someone goes looking at the tracker and finds nothing there.
  if (existing) {
    const { error } = await supabase.from("applications").update(payload).eq("id", existing.id);
    if (error) throw new Error(`Couldn't record your application: ${error.message}`);
  } else {
    const { error } = await supabase.from("applications").insert(payload);
    if (error) throw new Error(`Couldn't record your application: ${error.message}`);
  }

  // Deferred, not awaited: logCountryDefaultEvent's own header documents
  // that a logging failure inside it is swallowed (caught and console.error'd,
  // never thrown) and cannot fail the apply — exactly the kind of write
  // src/app/(app)/jobs/page.tsx's own after() block already defers off the
  // response path, for the same reason (the reader isn't waiting on it).
  after(async () => {
    await logCountryDefaultEvent({ userId, eventType: "apply", countryState, jobPostingId: jobId });
  });

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

  // See applyInAppAction's own comment above on why this is checked rather
  // than left to a silent no-op.
  if (existing) {
    const { error } = await supabase.from("applications").update(payload).eq("id", existing.id);
    if (error) throw new Error(`Couldn't record this as applied: ${error.message}`);
  } else {
    const { error } = await supabase.from("applications").insert(payload);
    if (error) throw new Error(`Couldn't record this as applied: ${error.message}`);
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
