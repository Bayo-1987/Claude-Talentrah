"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { runTalentVerification, type VerificationActionResult } from "./verification-runner";

/* ---------------------------------------------------------------------- *
 * Free + uncapped: opt-in, availability metadata, portfolio items touch no
 * LLM and cost nothing — same §6.9 reasoning as saving a job or a
 * scholarship.
 * ---------------------------------------------------------------------- */

export async function setDirectoryOptInAction(optIn: boolean) {
  const { user } = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ talent_directory_opt_in: optIn })
    .eq("id", user.id);
  if (error) throw error;
  revalidatePath("/talent-directory/verify");
}

export async function updateAvailabilityAction(_prev: unknown, formData: FormData) {
  const { user } = await requireUser();
  const supabase = await createClient();

  const earliestStart = String(formData.get("earliestStartDate") ?? "").trim();

  const { error } = await supabase
    .from("profiles")
    .update({
      talent_available_for_hire: formData.get("availableForHire") === "on",
      talent_remote_ready: formData.get("remoteReady") === "on",
      talent_earliest_start_date: earliestStart || null,
    })
    .eq("id", user.id);

  if (error) return { status: "error" as const, message: "Something went wrong." };
  revalidatePath("/talent-directory/verify");
  return { status: "success" as const, message: "Saved." };
}

export async function addPortfolioItemAction(_prev: unknown, formData: FormData) {
  const { user } = await requireUser();
  const supabase = await createClient();

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { status: "error" as const, message: "A title is required." };

  const { error } = await supabase.from("talent_portfolio_items").insert({
    user_id: user.id,
    title,
    description: String(formData.get("description") ?? "").trim() || null,
    url: String(formData.get("url") ?? "").trim() || null,
  });

  if (error) return { status: "error" as const, message: "Something went wrong." };
  revalidatePath("/talent-directory/verify");
  return { status: "success" as const, message: "Added." };
}

export async function deletePortfolioItemAction(itemId: string) {
  const { user } = await requireUser();
  const supabase = await createClient();
  await supabase.from("talent_portfolio_items").delete().eq("id", itemId).eq("user_id", user.id);
  revalidatePath("/talent-directory/verify");
}

/**
 * Credit-gated verification (send-139 / §6.13). Thin on purpose: the whole
 * flow — the claim, the LLM grade, the spend, the resolve — lives in
 * runTalentVerification (verification-runner.ts) as a plain function taking
 * a trusted userId, exactly the same split `checkEligibility`
 * (scholarships/farah.ts) already uses. This Server Action's only job is
 * resolving that id from a real session before handing it in.
 */
export type { VerificationActionResult };

export async function requestTalentVerificationAction(): Promise<VerificationActionResult> {
  const { user } = await requireUser();
  const result = await runTalentVerification(user.id);
  if (result.status === "success") revalidatePath("/talent-directory/verify");
  return result;
}
