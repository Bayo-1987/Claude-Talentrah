"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import {
  claimVerificationReview,
  releaseVerificationReviewClaim,
  resolveVerificationReview,
} from "./reviewer-runner";

const CLAIM_REASON_MESSAGE: Record<string, string> = {
  NOT_ELIGIBLE_REVIEWER: "You're not an eligible reviewer — check that you're an approved mentor who has opted in to reviewing.",
  ALREADY_CLAIMED: "Someone else already claimed that submission.",
  CANNOT_REVIEW_OWN_SUBMISSION: "You can't review your own verification submission.",
  error: "Could not claim that submission.",
};

export async function claimVerificationReviewAction(verificationId: string) {
  const { user } = await requireUser();
  const result = await claimVerificationReview(user.id, verificationId);
  if (!result.ok) {
    redirect(`/mentorship/reviews?error=${encodeURIComponent(CLAIM_REASON_MESSAGE[result.reason] ?? CLAIM_REASON_MESSAGE.error)}`);
  }
  revalidatePath("/mentorship/reviews");
  redirect(`/mentorship/reviews/${verificationId}`);
}

export async function releaseVerificationReviewClaimAction(verificationId: string) {
  const { user } = await requireUser();
  await releaseVerificationReviewClaim(user.id, verificationId);
  revalidatePath("/mentorship/reviews");
  redirect("/mentorship/reviews");
}

export async function decideVerificationReviewAction(_prev: unknown, formData: FormData) {
  const { user } = await requireUser();
  const verificationId = String(formData.get("verificationId") ?? "");
  const candidateId = String(formData.get("candidateId") ?? "");
  const verified = formData.get("decision") === "verified";
  const notes = String(formData.get("notes") ?? "");

  const result = await resolveVerificationReview(user.id, verificationId, candidateId, verified, notes);
  if (result.status === "success") {
    revalidatePath("/mentorship/reviews");
  }
  return result;
}
