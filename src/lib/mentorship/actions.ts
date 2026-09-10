"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { initializeTransaction, NGN_CHANNELS } from "@/lib/paystack/client";
import { generateMeetingLink } from "@/lib/mentorship/meeting-link";
import { notifySessionConfirmed } from "@/lib/mentorship/notifications";
import type { MentorshipSessionType } from "@/lib/mentorship/pricing";

function splitTags(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Mentor onboarding & vetting's application step. Goes through the
 * AUTHENTICATED client, not service role — 0133's own INSERT policy
 * (`user_id = auth.uid() and status = 'pending'`) is what stops anyone from
 * inserting themselves pre-approved, so there is nothing this Server Action
 * needs to check beyond letting RLS do its job.
 */
export async function applyToBecomeMentorAction(_prev: unknown, formData: FormData) {
  const { user } = await requireUser();
  const supabase = await createClient();

  const yearsRaw = String(formData.get("yearsExperience") ?? "").trim();
  const priceRaw = String(formData.get("basePriceNgn") ?? "").trim();

  const { error } = await supabase.from("mentor_profiles").insert({
    user_id: user.id,
    bio: String(formData.get("bio") ?? "").trim() || null,
    expertise_roles: splitTags(String(formData.get("expertiseRoles") ?? "")),
    expertise_industries: splitTags(String(formData.get("expertiseIndustries") ?? "")),
    years_experience: yearsRaw ? Number(yearsRaw) : null,
    // Empty means free/volunteer — 0133's own recommended v1 default, not an
    // error state, so an empty field maps to null rather than a validation
    // failure.
    base_price_ngn: priceRaw ? Number(priceRaw) : null,
  });

  if (error) {
    // 23505 = already applied (user_id is the primary key).
    return { status: "error" as const, message: error.code === "23505" ? "You've already applied." : "Something went wrong." };
  }

  revalidatePath("/mentorship/apply");
  return { status: "success" as const, message: "Application submitted — you'll hear back once an admin reviews it." };
}

/** Column-grant-restricted to the safe fields only (0133) — status/reviewed_* cannot move through this path even if attempted. */
export async function updateMentorProfileAction(_prev: unknown, formData: FormData) {
  const { user } = await requireUser();
  const supabase = await createClient();

  const yearsRaw = String(formData.get("yearsExperience") ?? "").trim();
  const priceRaw = String(formData.get("basePriceNgn") ?? "").trim();

  const { error } = await supabase
    .from("mentor_profiles")
    .update({
      bio: String(formData.get("bio") ?? "").trim() || null,
      expertise_roles: splitTags(String(formData.get("expertiseRoles") ?? "")),
      expertise_industries: splitTags(String(formData.get("expertiseIndustries") ?? "")),
      years_experience: yearsRaw ? Number(yearsRaw) : null,
      base_price_ngn: priceRaw ? Number(priceRaw) : null,
    })
    .eq("user_id", user.id);

  if (error) return { status: "error" as const, message: "Something went wrong." };
  revalidatePath("/mentorship/apply");
  return { status: "success" as const, message: "Saved." };
}

/**
 * The reviewer opt-in toggle (0141/0142's own design decision: an approved
 * mentor is NOT automatically a verification reviewer — this is a second,
 * explicit choice, same shape talent-directory/actions.ts's
 * setDirectoryOptInAction already uses for the mirror-image decision on the
 * seeker side). Goes through the authenticated client — 0142's column grant
 * is the only thing standing between this and every other mentor_profiles
 * column, same 0030 discipline as every other column-grant-restricted
 * update in this codebase.
 */
export async function setReviewsVerificationsOptInAction(optIn: boolean) {
  const { user } = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("mentor_profiles")
    .update({ reviews_verifications: optIn })
    .eq("user_id", user.id);
  if (error) throw error;
  revalidatePath("/mentorship/apply");
}

export async function postAvailabilitySlotAction(startAt: string, endAt: string) {
  const { user } = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.from("mentor_availability_slots").insert({
    mentor_id: user.id,
    start_at: startAt,
    end_at: endAt,
  });
  if (error) throw new Error("Could not post that slot.");
  revalidatePath("/mentorship/apply");
}

/** RLS's own precondition (`is_booked = false`) is the entire guard — a booked slot simply won't match and the delete is a silent no-op. */
export async function deleteAvailabilitySlotAction(slotId: string) {
  const { user } = await requireUser();
  const supabase = await createClient();
  await supabase.from("mentor_availability_slots").delete().eq("id", slotId).eq("mentor_id", user.id);
  revalidatePath("/mentorship/apply");
}

async function getOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const protocol = h.get("x-forwarded-proto") ?? "http";
  return `${protocol}://${host}`;
}

/**
 * Book a slot, then either send the mentee to Paystack (a paid session) or
 * straight to their session list (free — `book_mentor_session` already
 * landed it in `awaiting_confirmation`, there is nothing left to pay).
 *
 * `book_mentor_session` is service_role-only (0133's own header explains
 * why) — this Server Action is the trusted boundary that resolves
 * `user.id` from the session before handing it in as `p_mentee_id`, exactly
 * the same shape `initiatePurchaseAction` already uses for credit
 * packs/passes.
 */
export async function bookMentorSessionAction(availabilitySlotId: string, sessionType: MentorshipSessionType) {
  const { user } = await requireUser();
  const serviceClient = createServiceRoleClient();

  const { data: rows, error } = await serviceClient.rpc("book_mentor_session", {
    p_availability_slot_id: availabilitySlotId,
    p_mentee_id: user.id,
    p_session_type: sessionType,
  });

  if (error || !rows?.[0]) {
    const reason =
      error?.message.includes("SLOT_UNAVAILABLE")
        ? "That slot was just booked by someone else."
        : error?.message.includes("MENTOR_NOT_APPROVED")
          ? "This mentor isn't currently bookable."
          : "Could not book that session.";
    redirect(`/mentorship?error=${encodeURIComponent(reason)}`);
  }

  const { session_id: sessionId, price_ngn: priceNgn } = rows[0];

  if (priceNgn === 0) {
    revalidatePath("/mentorship/sessions");
    redirect(`/mentorship/sessions?booked=1`);
  }

  const reference = `mentor_session_${randomUUID()}`;
  const origin = await getOrigin();
  await serviceClient.from("payment_transactions").insert({
    user_id: user.id,
    rail: "paystack",
    amount: priceNgn,
    currency: "NGN",
    product_type: "mentor_session",
    product_id: sessionId,
    paystack_reference: reference,
    status: "pending",
  });

  let authorizationUrl: string;
  try {
    const init = await initializeTransaction({
      email: user.email!,
      amountNgn: priceNgn,
      reference,
      callbackUrl: `${origin}/mentorship/book/callback`,
      metadata: { productType: "mentor_session", productId: sessionId, userId: user.id },
      channels: NGN_CHANNELS,
    });
    authorizationUrl = init.authorization_url;
  } catch {
    await serviceClient.from("payment_transactions").update({ status: "failed" }).eq("paystack_reference", reference);
    redirect(`/mentorship?error=${encodeURIComponent("Payments are unavailable right now.")}`);
  }

  redirect(authorizationUrl);
}

/**
 * The mentor's own confirmation step. `mark_mentor_session_confirmed`
 * (0133) is service_role-only for the same reason `book_mentor_session` is —
 * this Server Action resolves `user.id` from the session and hands it in as
 * `p_mentor_id`, checked against the session row's own `mentor_id` inside
 * the function rather than trusted blindly.
 */
export async function confirmMentorSessionAction(sessionId: string) {
  const { user } = await requireUser();
  const serviceClient = createServiceRoleClient();

  const { data: ok, error } = await serviceClient.rpc("mark_mentor_session_confirmed", {
    p_session_id: sessionId,
    p_mentor_id: user.id,
    p_meeting_link: generateMeetingLink(),
  });

  if (error || !ok) throw new Error("Could not confirm that session.");

  // Best-effort — notifySessionConfirmed never throws (see its own header).
  // The confirmation itself already succeeded above; a notification failure
  // must not turn a successful confirm into an error the mentor sees.
  await notifySessionConfirmed(sessionId);

  revalidatePath("/mentorship/sessions/mentor");
  revalidatePath("/mentorship/sessions");
}

export async function submitMentorshipReviewAction(sessionId: string, mentorId: string, rating: number, reviewText: string) {
  const { user } = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.from("mentorship_reviews").insert({
    session_id: sessionId,
    mentor_id: mentorId,
    reviewer_id: user.id,
    rating,
    review_text: reviewText.trim() || null,
  });
  if (error) throw new Error("Could not submit that review.");
  revalidatePath("/mentorship/sessions");
}
