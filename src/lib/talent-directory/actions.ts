"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { requireEmployer } from "@/lib/employer/membership";
import { createClient } from "@/lib/supabase/server";
import {
  runTalentVerification,
  runTalentVerificationHumanReview,
  type VerificationActionResult,
} from "./verification-runner";
import { runTalentDirectoryBoostPurchase, type BoostActionResult } from "./boost-runner";
import {
  runTalentDirectoryContactRequest,
  runTalentDirectoryContactResponse,
  type ContactRequestResult,
  type ContactResponseResult,
} from "./contact-runner";

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

/**
 * The higher-cost, human-reviewed tier (0141/0142) alongside the AI-only
 * action above. Thin for the same reason: the whole flow lives in
 * runTalentVerificationHumanReview (verification-runner.ts) as a plain
 * function taking a trusted userId — this Server Action's only job is
 * resolving that id from a real session and passing through the optional
 * target role/industry the candidate typed in.
 */
export async function requestHumanReviewVerificationAction(
  _prev: unknown,
  formData: FormData,
): Promise<VerificationActionResult> {
  const { user } = await requireUser();
  const result = await runTalentVerificationHumanReview(
    user.id,
    String(formData.get("targetRole") ?? "").trim() || null,
    String(formData.get("targetIndustry") ?? "").trim() || null,
  );
  if (result.status === "success") revalidatePath("/talent-directory/verify");
  return result;
}

/**
 * Talent Directory v2, part 1 (§6.13's third buyer segment): a verified,
 * opted-in seeker spends credits for a time-boxed top-of-search placement.
 * Thin for the same reason requestTalentVerificationAction is thin — the
 * whole flow lives in runTalentDirectoryBoostPurchase (boost-runner.ts) as a
 * plain function taking a trusted userId, so it's callable directly from
 * tests without a real Next.js request context.
 */
export type { BoostActionResult };

export async function requestTalentDirectoryBoostAction(): Promise<BoostActionResult> {
  const { user } = await requireUser();
  const result = await runTalentDirectoryBoostPurchase(user.id);
  if (result.status === "success") revalidatePath("/talent-directory/verify");
  return result;
}

/**
 * send-157 — an employer sends interest in a directory candidate.
 * `organization.id` is resolved here, through the session
 * (requireEmployer()), and handed to the runner as a trusted value — never a
 * client-supplied organisation id, the same boundary claimJobPostingAction
 * draws for claim_external_job_posting.
 */
export type { ContactRequestResult };

export async function sendTalentDirectoryContactRequestAction(
  candidateId: string,
  _prev: unknown,
  formData: FormData,
): Promise<ContactRequestResult> {
  const { organization, userId } = await requireEmployer();
  const message = String(formData.get("message") ?? "").trim();
  const result = await runTalentDirectoryContactRequest(organization.id, userId, candidateId, message);
  if (result.status === "success") revalidatePath(`/employer/talent-directory/${candidateId}`);
  return result;
}

/**
 * send-157 — the candidate's own approve/decline. `user.id` is resolved
 * here, through the session, and handed to the runner as p_candidateId —
 * checked again inside respond_to_talent_directory_contact_request against
 * the row's own candidate_id, not trusted blindly.
 */
export type { ContactResponseResult };

export async function respondToTalentDirectoryContactRequestAction(
  requestId: string,
  approve: boolean,
): Promise<void> {
  const { user } = await requireUser();
  await runTalentDirectoryContactResponse(requestId, user.id, approve);
  revalidatePath("/talent-directory/verify");
}
