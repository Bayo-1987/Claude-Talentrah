import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getResendClient } from "@/lib/resend/client";
import { absoluteUrl } from "@/lib/seo/site";
import type { BookDeps, BookingContext, NoneWorkDeps } from "./booking";
import type { InterviewKind } from "./constants";
import type { OfferDeps } from "./offer";

const FROM = (name: string) => `${name} <notifications@talentrah.com>`;
const fullName = (first: string | null | undefined, last: string | null | undefined) => [first, last].map((p) => p?.trim()).filter(Boolean).join(" ");

async function send(p: { to: string; subject: string; text: string; html: string; replyTo?: string; fromName?: string; attachments?: Array<{ filename: string; content: string }> }): Promise<boolean> {
  const resend = getResendClient();
  if (!resend) {
    console.error("[interviews] RESEND_API_KEY is not set: nothing was sent");
    return false;
  }
  const { error } = await resend.emails.send({
    from: FROM(p.fromName ?? "Talentrah"),
    to: p.to,
    subject: p.subject,
    text: p.text,
    html: p.html,
    ...(p.replyTo ? { replyTo: p.replyTo } : {}),
    ...(p.attachments ? { attachments: p.attachments } : {}),
  });
  return !error;
}

/** The real dependencies of "offer times": the 0253 function with the service role (after the Server Action's own session checks), the candidate read only for the one email. */
export function defaultOfferDeps(): OfferDeps {
  const admin = createServiceRoleClient();
  return {
    async context({ applicationId, jobId, organizationId }) {
      const { data: application } = await admin.from("applications").select("user_id, job_posting_id, applied_at").eq("id", applicationId).maybeSingle();
      if (!application || application.job_posting_id !== jobId || !application.applied_at) return null;
      const { data: job } = await admin.from("job_postings").select("title, organization_id").eq("id", jobId).maybeSingle();
      if (!job || job.organization_id !== organizationId) return null;
      const [{ data: org }, { data: profile }] = await Promise.all([
        admin.from("organizations").select("name").eq("id", organizationId).maybeSingle(),
        admin.from("profiles").select("email, deletion_requested_at").eq("id", application.user_id).maybeSingle(),
      ]);
      if (!org || !profile) return null;
      return { orgName: org.name, jobTitle: job.title, candidateEmail: profile.email, deletionRequestedAt: profile.deletion_requested_at };
    },
    async createOffer({ userId, applicationId, kind, note, slots }) {
      const { data, error } = await admin.rpc("create_interview_offer", { p_user: userId, p_application: applicationId, p_kind: kind, p_note: note as string, p_slots: slots });
      if (error) throw new Error(error.message);
      const row = data?.[0];
      return { ok: !!row?.ok, outcome: row?.outcome ?? "failed", offerId: row?.offer_id ?? null, messageId: row?.message_id ?? null };
    },
    deliver: send,
    async freeUnit(messageId) {
      const { error } = await admin.from("applicant_messages").update({ status: "failed", failure_reason: "interview invitation email not sent" }).eq("id", messageId).eq("status", "claimed");
      if (error) throw new Error(error.message);
    },
    pickUrl: (offerId) => absoluteUrl(`/interviews/${offerId}`),
  };
}

/** The real dependencies of booking and of "none of these work". */
export function defaultBookDeps(): BookDeps {
  const admin = createServiceRoleClient();
  return {
    async book({ userId, slotId }) {
      const { data, error } = await admin.rpc("book_interview_slot", { p_user: userId, p_slot: slotId });
      if (error) throw new Error(error.message);
      const row = data?.[0];
      return { ok: !!row?.ok, outcome: row?.outcome ?? "failed", bookingId: row?.booking_id ?? null, startsAt: row?.starts_at ?? null };
    },
    async context(bookingId): Promise<BookingContext | null> {
      const { data: booking } = await admin.from("interview_bookings").select("offer_id, application_id, job_posting_id, organization_id, duration_minutes").eq("id", bookingId).maybeSingle();
      if (!booking) return null;
      const { data: offer } = await admin.from("interview_offers").select("kind, note, created_by").eq("id", booking.offer_id).maybeSingle();
      const { data: application } = await admin.from("applications").select("user_id").eq("id", booking.application_id).maybeSingle();
      if (!offer || !application) return null;
      const [{ data: org }, { data: job }, { data: candidate }, creator] = await Promise.all([
        admin.from("organizations").select("name").eq("id", booking.organization_id).maybeSingle(),
        admin.from("job_postings").select("title").eq("id", booking.job_posting_id).maybeSingle(),
        admin.from("profiles").select("email, first_name, last_name, deletion_requested_at").eq("id", application.user_id).maybeSingle(),
        offer.created_by ? admin.from("profiles").select("email, deletion_requested_at").eq("id", offer.created_by).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      return {
        orgName: org?.name ?? "the employer",
        jobTitle: job?.title ?? "the role",
        kind: offer.kind as InterviewKind,
        note: offer.note,
        durationMinutes: booking.duration_minutes,
        offerId: booking.offer_id,
        jobId: booking.job_posting_id,
        applicationId: booking.application_id,
        candidateName: fullName(candidate?.first_name, candidate?.last_name),
        candidateEmail: candidate && !candidate.deletion_requested_at ? candidate.email : null,
        employerEmail: creator.data && !creator.data.deletion_requested_at ? creator.data.email : null,
      };
    },
    deliver: send,
    candidateUrl: (offerId) => absoluteUrl(`/interviews/${offerId}`),
    employerUrl: (jobId, applicationId) => absoluteUrl(`/employer/jobs/${jobId}/applicants/${applicationId}/schedule`),
  };
}

export function defaultNoneWorkDeps(): NoneWorkDeps {
  const admin = createServiceRoleClient();
  return {
    async load({ userId, offerId }) {
      const { data: offer } = await admin.from("interview_offers").select("id, application_id, job_posting_id, created_by").eq("id", offerId).maybeSingle();
      if (!offer) return null;
      const { data: application } = await admin.from("applications").select("user_id").eq("id", offer.application_id).maybeSingle();
      if (!application || application.user_id !== userId) return null;
      const [{ data: state }, { data: job }, { data: candidate }, creator] = await Promise.all([
        admin.rpc("interview_offer_state", { p_offer: offerId }),
        admin.from("job_postings").select("title").eq("id", offer.job_posting_id).maybeSingle(),
        admin.from("profiles").select("first_name, last_name").eq("id", userId).maybeSingle(),
        offer.created_by ? admin.from("profiles").select("email, deletion_requested_at").eq("id", offer.created_by).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      return {
        state: state ?? "not_found",
        creatorUserId: offer.created_by,
        creatorEmail: creator.data && !creator.data.deletion_requested_at ? creator.data.email : null,
        candidateName: fullName(candidate?.first_name, candidate?.last_name),
        jobTitle: job?.title ?? "the role",
        jobId: offer.job_posting_id,
        applicationId: offer.application_id,
      };
    },
    async alreadyReported({ offerId, creatorUserId }) {
      const { count } = await admin.from("user_notifications").select("id", { count: "exact", head: true }).eq("user_id", creatorUserId).eq("type", "interview_none_work").like("link", `%offer=${offerId}%`);
      return (count ?? 0) > 0;
    },
    async note({ creatorUserId, offerId, candidateName, jobTitle, link }) {
      const path = new URL(link).pathname;
      const { error } = await admin.from("user_notifications").insert({
        user_id: creatorUserId,
        type: "interview_none_work",
        title: `${candidateName || "An applicant"} can't make any of the times`,
        body: `For ${jobTitle}. You can offer new times.`,
        link: `${path}?offer=${offerId}`,
      });
      if (error) throw new Error(error.message);
    },
    deliver: send,
    scheduleUrl: (jobId, applicationId) => absoluteUrl(`/employer/jobs/${jobId}/applicants/${applicationId}/schedule`),
  };
}

/** The real dependencies of "send the invitation again". */
export function defaultResendDeps(): import("./offer").ResendDeps {
  const admin = createServiceRoleClient();
  return {
    async load({ applicationId, jobId, organizationId }) {
      const { data: offer } = await admin.from("interview_offers").select("id, kind, note, job_posting_id, organization_id").eq("application_id", applicationId).eq("status", "open").maybeSingle();
      if (!offer || offer.job_posting_id !== jobId || offer.organization_id !== organizationId) return null;
      const [{ data: slots }, { data: application }, { data: org }, { data: job }] = await Promise.all([
        admin.from("interview_slots").select("duration_minutes").eq("offer_id", offer.id),
        admin.from("applications").select("user_id").eq("id", applicationId).maybeSingle(),
        admin.from("organizations").select("name").eq("id", organizationId).maybeSingle(),
        admin.from("job_postings").select("title").eq("id", jobId).maybeSingle(),
      ]);
      if (!slots?.length || !application || !org || !job) return null;
      const { data: profile } = await admin.from("profiles").select("email, deletion_requested_at").eq("id", application.user_id).maybeSingle();
      if (!profile) return null;
      return { offerId: offer.id, kind: offer.kind, note: offer.note, slotCount: slots.length, durationMinutes: slots[0].duration_minutes, orgName: org.name, jobTitle: job.title, candidateEmail: profile.email, deletionRequestedAt: profile.deletion_requested_at };
    },
    async claimUnit({ organizationId, applicationId, jobId, userId, subject }) {
      const { data, error } = await admin.rpc("claim_applicant_message", {
        p_organization_id: organizationId,
        p_application_id: applicationId,
        p_job_posting_id: jobId,
        p_sender_user_id: userId,
        p_kind: "interview_invite",
        p_subject: subject,
        p_body: "Interview invitation (sent again).",
      });
      if (error) throw new Error(error.message);
      return data;
    },
    deliver: send,
    async freeUnit(messageId) {
      const { error } = await admin.from("applicant_messages").update({ status: "failed", failure_reason: "interview invitation email not sent" }).eq("id", messageId).eq("status", "claimed");
      if (error) throw new Error(error.message);
    },
    pickUrl: (offerId) => absoluteUrl(`/interviews/${offerId}`),
  };
}

/** The real dependencies of the scheduled interview emails (the 0253 backstops and claim functions, the service role). */
export function defaultNoticeDeps(): import("./notices").NoticeDeps {
  const admin = createServiceRoleClient();
  const toBooking = (r: { booking_id: string; application_id: string; job_posting_id: string; organization_id: string; starts_at: string }, duration: number) => ({
    bookingId: r.booking_id,
    applicationId: r.application_id,
    jobId: r.job_posting_id,
    organizationId: r.organization_id,
    startsAt: new Date(r.starts_at).toISOString(),
    durationMinutes: duration,
  });
  return {
    async sweep() {
      const [cancelled, expired] = await Promise.all([admin.rpc("cancel_stale_interview_bookings"), admin.rpc("expire_interview_offers")]);
      if (cancelled.error) throw new Error(cancelled.error.message);
      if (expired.error) throw new Error(expired.error.message);
      return { cancelled: cancelled.data ?? 0, expired: expired.data ?? 0 };
    },
    async claimCancellations() {
      const { data, error } = await admin.rpc("claim_interview_cancellation_emails");
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      if (rows.length === 0) return [];
      const { data: durations } = await admin.from("interview_bookings").select("id, duration_minutes").in("id", rows.map((r) => r.booking_id));
      const byId = new Map((durations ?? []).map((d) => [d.id, d.duration_minutes]));
      return rows.map((r) => toBooking(r, byId.get(r.booking_id) ?? 45));
    },
    async releaseCancellation(bookingId) {
      const { error } = await admin.rpc("release_interview_cancellation_email", { p_booking: bookingId });
      if (error) throw new Error(error.message);
    },
    async claimReminders(from, to) {
      const { data, error } = await admin.rpc("claim_interview_reminders", { p_from: from.toISOString(), p_to: to.toISOString() });
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => toBooking(r, r.duration_minutes));
    },
    async releaseReminder(bookingId) {
      const { error } = await admin.rpc("release_interview_reminder", { p_booking: bookingId });
      if (error) throw new Error(error.message);
    },
    async context(booking) {
      const { data: bookingRow } = await admin.from("interview_bookings").select("offer_id, application_id").eq("id", booking.bookingId).maybeSingle();
      if (!bookingRow) return null;
      const [{ data: offer }, { data: application }, { data: org }, { data: job }] = await Promise.all([
        admin.from("interview_offers").select("created_by").eq("id", bookingRow.offer_id).maybeSingle(),
        admin.from("applications").select("user_id").eq("id", bookingRow.application_id).maybeSingle(),
        admin.from("organizations").select("name").eq("id", booking.organizationId).maybeSingle(),
        admin.from("job_postings").select("title").eq("id", booking.jobId).maybeSingle(),
      ]);
      if (!application) return null;
      const [{ data: candidate }, creator] = await Promise.all([
        admin.from("profiles").select("email, first_name, last_name, deletion_requested_at").eq("id", application.user_id).maybeSingle(),
        offer?.created_by ? admin.from("profiles").select("email, deletion_requested_at").eq("id", offer.created_by).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      return {
        orgName: org?.name ?? "the employer",
        jobTitle: job?.title ?? "the role",
        offerId: bookingRow.offer_id,
        candidateName: fullName(candidate?.first_name, candidate?.last_name),
        candidateEmail: candidate && !candidate.deletion_requested_at ? candidate.email : null,
        employerEmail: creator.data && !creator.data.deletion_requested_at ? creator.data.email : null,
      };
    },
    send,
    candidateUrl: (offerId) => absoluteUrl(`/interviews/${offerId}`),
    employerUrl: (jobId, applicationId) => absoluteUrl(`/employer/jobs/${jobId}/applicants/${applicationId}/schedule`),
  };
}
