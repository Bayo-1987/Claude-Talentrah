"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireEmployer } from "@/lib/employer/membership";
import { isApplicantOfMyJob } from "@/lib/employer/applicant-messages/authorize";
import { createInterviewOffer, resendInterviewInvitation } from "./offer";
import { bookInterviewSlot, reportNoneWork } from "./booking";
import { defaultBookDeps, defaultNoneWorkDeps, defaultOfferDeps, defaultResendDeps } from "./deps";
import { validateSlots } from "./slots-input";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND = "We couldn't find that applicant. Reload the page and try again.";
const UNVERIFIED = "Verify your company first. Invitations are sent from Talentrah, so only verified companies can send them. You can do this on your Company Profile.";

type Gate = { ok: true; userId: string; email: string | null; organizationId: string; jobId: string; applicationId: string } | { ok: false; error: string };

/**
 * The checks every employer-side interview action starts with, in the employer's OWN session: signed in, an organisation (requireEmployer), a VERIFIED organisation (invitations go out from Talentrah's
 * address), a confirmed email (it becomes the Reply-To), identifiers shaped like ids, and an applicant of THIS organisation's job (employer_job_applicants, its own membership check). Only then does anything run with the service role.
 */
async function employerGate(input: { jobId: string; applicationId: string }): Promise<Gate> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in again to continue." };
  const { organization, emailConfirmed } = await requireEmployer();
  if (!organization.verified) return { ok: false, error: UNVERIFIED };
  if (!emailConfirmed) return { ok: false, error: "Confirm your email address first: the candidate's replies will come to it." };
  const jobId = typeof input.jobId === "string" ? input.jobId : "";
  const applicationId = typeof input.applicationId === "string" ? input.applicationId : "";
  if (!UUID.test(jobId) || !UUID.test(applicationId)) return { ok: false, error: NOT_FOUND };
  if (!(await isApplicantOfMyJob(supabase, { organizationId: organization.id, jobId, applicationId }))) return { ok: false, error: NOT_FOUND };
  return { ok: true, userId: user.id, email: user.email ?? null, organizationId: organization.id, jobId, applicationId };
}

export type OfferActionResult = { ok: true; offerId: string } | { ok: false; error: string; offerId?: string; reason?: string };

/** "Offer times": 2 to 5 times, a length, a kind and a note; see createInterviewOffer for the order of the steps. */
export async function createInterviewOfferAction(input: { jobId: string; applicationId: string; kind: string; note: string; times: string[]; durationMinutes: number }): Promise<OfferActionResult> {
  const gate = await employerGate(input);
  if (!gate.ok) return { ok: false, error: gate.error };
  const result = await createInterviewOffer(
    { organizationId: gate.organizationId, jobId: gate.jobId, applicationId: gate.applicationId, userId: gate.userId, senderEmail: gate.email, kind: input.kind, note: typeof input.note === "string" ? input.note : null, times: Array.isArray(input.times) ? input.times : [], durationMinutes: Number(input.durationMinutes) },
    defaultOfferDeps(),
  );
  return result.ok ? { ok: true, offerId: result.offerId } : { ok: false, error: result.message, reason: result.reason, ...(result.offerId ? { offerId: result.offerId } : {}) };
}

export async function resendInterviewInvitationAction(input: { jobId: string; applicationId: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await employerGate(input);
  if (!gate.ok) return { ok: false, error: gate.error };
  const result = await resendInterviewInvitation({ organizationId: gate.organizationId, jobId: gate.jobId, applicationId: gate.applicationId, userId: gate.userId, senderEmail: gate.email }, defaultResendDeps());
  return result.ok ? { ok: true } : { ok: false, error: result.message };
}

export type OverlapWarning = { slotIndex: number; jobTitle: string };

/**
 * The UI-only overlap WARNING (never a block): which of the times being offered overlap an interview already BOOKED for any job of this organisation. The database answers (and only for a member of the
 * organisation); this only names the job. A refused or failed check answers "no warnings": it must never stand in the way of offering times.
 */
export async function interviewOverlapWarningsAction(input: { jobId: string; applicationId: string; times: string[]; durationMinutes: number }): Promise<OverlapWarning[]> {
  try {
    const gate = await employerGate(input);
    if (!gate.ok) return [];
    const slots = validateSlots({ times: Array.isArray(input.times) ? input.times : [], durationMinutes: Number(input.durationMinutes) });
    if (!slots.ok) return [];
    const admin = createServiceRoleClient();
    const { data } = await admin.rpc("interview_overlaps", { p_user: gate.userId, p_organization: gate.organizationId, p_slots: slots.slots });
    const rows = data ?? [];
    if (rows.length === 0) return [];
    const { data: jobs } = await admin.from("job_postings").select("id, title").in("id", [...new Set(rows.map((r) => r.job_posting_id))]);
    const titles = new Map((jobs ?? []).map((j) => [j.id, j.title]));
    return rows.map((r) => ({ slotIndex: r.slot_index, jobTitle: titles.get(r.job_posting_id) ?? "another job" }));
  } catch {
    return [];
  }
}

async function signedInUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export type BookActionResult = { ok: true; startsAt: string } | { ok: false; error: string; reason: string };

/** The candidate books one offered time. Ownership is checked in SQL against the signed-in user; the time zone only decides how the candidate's own confirmation reads. */
export async function bookInterviewSlotAction(input: { slotId: string; timeZone: string }): Promise<BookActionResult> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, reason: "not_signed_in", error: "Sign in again to book a time." };
  const slotId = typeof input.slotId === "string" ? input.slotId : "";
  if (!UUID.test(slotId)) return { ok: false, reason: "not_found", error: "We couldn't find that invitation." };
  const result = await bookInterviewSlot({ userId, slotId, timeZone: typeof input.timeZone === "string" ? input.timeZone : "UTC" }, defaultBookDeps());
  return result.ok ? { ok: true, startsAt: result.startsAt } : { ok: false, reason: result.reason, error: result.message };
}

export async function noneOfTheseTimesWorkAction(input: { offerId: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, error: "Sign in again to continue." };
  const offerId = typeof input.offerId === "string" ? input.offerId : "";
  if (!UUID.test(offerId)) return { ok: false, error: "We couldn't find that invitation." };
  const result = await reportNoneWork({ userId, offerId }, defaultNoneWorkDeps());
  return result.ok ? { ok: true } : { ok: false, error: result.message };
}
