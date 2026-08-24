"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
    await supabase
      .from("applications")
      .insert({ user_id: userId, job_posting_id: jobId, stage: "saved", source: "manual" });
  } else if (existing.stage === "saved") {
    await supabase.from("applications").delete().eq("id", existing.id);
  }

  revalidatePath("/jobs");
}

/** Internal jobs: applies in-app using the user's base resume. */
export async function applyInAppAction(jobId: string) {
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

  const { data: existing } = await supabase
    .from("applications")
    .select("id")
    .eq("user_id", userId)
    .eq("job_posting_id", jobId)
    .maybeSingle();

  const payload = {
    user_id: userId,
    job_posting_id: jobId,
    resume_id: baseResume?.id ?? null,
    stage: "applied" as const,
    source: "internal_apply" as const,
    applied_at: new Date().toISOString(),
  };

  if (existing) {
    await supabase.from("applications").update(payload).eq("id", existing.id);
  } else {
    await supabase.from("applications").insert(payload);
  }

  revalidatePath("/jobs");
  revalidatePath("/tracker");
}

/** External jobs: the actual application happens on the source site; this just logs it. */
export async function markAppliedExternallyAction(jobId: string) {
  const { supabase, userId } = await getAuthedUserId();

  const { data: existing } = await supabase
    .from("applications")
    .select("id")
    .eq("user_id", userId)
    .eq("job_posting_id", jobId)
    .maybeSingle();

  const payload = {
    user_id: userId,
    job_posting_id: jobId,
    stage: "applied" as const,
    source: "manual" as const,
    applied_at: new Date().toISOString(),
  };

  if (existing) {
    await supabase.from("applications").update(payload).eq("id", existing.id);
  } else {
    await supabase.from("applications").insert(payload);
  }

  revalidatePath("/jobs");
  revalidatePath("/tracker");
}
