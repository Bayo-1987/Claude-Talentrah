"use server";

import { revalidatePath } from "next/cache";
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

  const { data: existing } = await supabase
    .from("applications")
    .select("applied_at")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .single();

  await supabase
    .from("applications")
    .update({
      stage,
      applied_at: existing?.applied_at ?? (stage === "saved" ? null : new Date().toISOString()),
    })
    .eq("id", applicationId)
    .eq("user_id", userId);

  revalidatePath("/tracker");
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
