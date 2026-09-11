import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getResendClient } from "@/lib/resend/client";
import { buildContactRequestNoticeEmail, buildContactApprovedEmail } from "./contact-email";

/**
 * send-157 — the actual work behind sendTalentDirectoryContactRequestAction/
 * respondToTalentDirectoryContactRequestAction (actions.ts), the same
 * "thin Server Action, real logic in its own runner" split
 * verification-runner.ts/boost-runner.ts already establish in this
 * directory — callable directly from tests without a real Next.js request
 * context.
 */

export type ContactRequestResult =
  | { status: "success"; requestId: string }
  | { status: "error"; message: string };

const REASON_MESSAGES: Record<string, string> = {
  not_subscribed: "Your organisation doesn't have an active Talent Directory subscription.",
  candidate_not_listed: "This candidate is no longer listed in the directory.",
  message_required: "Add a short note before sending.",
  rate_limited: "You've sent a lot of requests today — try again tomorrow.",
  already_pending: "You already have a request pending with this candidate.",
};

/**
 * `organizationId` and `requestedBy` are both resolved by the caller
 * (requireEmployer(), reading the session's own membership) — never
 * accepted from a form field. request_talent_directory_contact (0155/0156)
 * is service_role-only and is called here via createServiceRoleClient(),
 * which carries no per-user JWT — auth.uid() is always null in that
 * context, so both values are trusted outright rather than re-derived
 * inside the function, the same actual pattern claim_external_job_posting
 * uses for its own p_organization_id (0156's header has the full story,
 * including the auth.uid() bug this replaced).
 */
export async function runTalentDirectoryContactRequest(
  organizationId: string,
  requestedBy: string,
  candidateId: string,
  message: string,
): Promise<ContactRequestResult> {
  const admin = createServiceRoleClient();

  const { data, error } = await admin.rpc("request_talent_directory_contact", {
    p_organization_id: organizationId,
    p_candidate_id: candidateId,
    p_message: message,
    p_requested_by: requestedBy,
  });

  if (error) {
    return { status: "error", message: "Couldn't send that request right now." };
  }

  const row = data?.[0];
  if (!row?.ok || !row.request_id) {
    return { status: "error", message: REASON_MESSAGES[row?.reason ?? ""] ?? "Couldn't send that request." };
  }

  // Deferred, not awaited by the caller — a notice-email failure must never
  // fail the request itself, the same reasoning proactive-match-alert's own
  // send-vs-record split gives (in-app state is already committed; the
  // email is a best-effort notice on top of it, not the source of truth).
  try {
    const [{ data: candidate }, { data: org }] = await Promise.all([
      admin.from("profiles").select("email, first_name").eq("id", candidateId).maybeSingle(),
      admin.from("organizations").select("name").eq("id", organizationId).maybeSingle(),
    ]);

    if (candidate?.email && org?.name) {
      const resend = getResendClient();
      if (resend) {
        const email = buildContactRequestNoticeEmail({
          firstName: candidate.first_name,
          companyName: org.name,
          message,
        });
        await resend.emails.send({
          from: "Farah at Talentrah <farah@talentrah.com>",
          to: candidate.email,
          subject: email.subject,
          text: email.text,
          html: email.html,
        });
      }
    }
  } catch (err) {
    console.error("[talent-directory-contact] notice email failed:", err);
  }

  return { status: "success", requestId: row.request_id };
}

export type ContactResponseResult =
  | { status: "success" }
  | { status: "error"; message: string };

/**
 * `candidateId` is resolved by the caller from their own session, the same
 * defense-in-depth shape confirmMentorSessionAction/mark_mentor_session_confirmed
 * (0133) already use — the RPC checks it against the row's own candidate_id
 * again rather than trusting it blindly.
 *
 * The contact-info reveal (the whole point of an APPROVE) happens here, in
 * application code, not in SQL: the RPC only flips status — see this
 * migration's own header on why an email is the reveal mechanism rather
 * than a new read endpoint an employer's browser could load.
 */
export async function runTalentDirectoryContactResponse(
  requestId: string,
  candidateId: string,
  approve: boolean,
): Promise<ContactResponseResult> {
  const admin = createServiceRoleClient();

  const { data: ok, error } = await admin.rpc("respond_to_talent_directory_contact_request", {
    p_request_id: requestId,
    p_candidate_id: candidateId,
    p_approve: approve,
  });

  if (error) {
    return { status: "error", message: "Couldn't record your decision right now." };
  }
  if (!ok) {
    return { status: "error", message: "That request has already been decided, or doesn't belong to you." };
  }

  if (approve) {
    // Same "log and continue, never fail the write that already succeeded"
    // shape as the notice email above — the approval itself is already
    // recorded; a reveal-email failure means the employer needs a manual
    // follow-up, not that the candidate's decision gets rolled back.
    try {
      const { data: request } = await admin
        .from("talent_directory_contact_requests")
        .select("organization_id, requested_by")
        .eq("id", requestId)
        .maybeSingle();

      const [{ data: candidate }, { data: employer }] = await Promise.all([
        admin.from("profiles").select("email, first_name, last_name").eq("id", candidateId).maybeSingle(),
        request?.requested_by
          ? admin.from("profiles").select("email, first_name").eq("id", request.requested_by).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      if (candidate?.email && employer?.email) {
        const resend = getResendClient();
        if (resend) {
          const candidateName =
            [candidate.first_name, candidate.last_name].filter(Boolean).join(" ") || "The candidate";
          const email = buildContactApprovedEmail({
            employerFirstName: employer.first_name,
            candidateName,
            candidateEmail: candidate.email,
          });
          await resend.emails.send({
            from: "Talentrah <notifications@talentrah.com>",
            to: employer.email,
            subject: email.subject,
            text: email.text,
            html: email.html,
          });
        }
      }
    } catch (err) {
      console.error("[talent-directory-contact] approval reveal email failed:", err);
    }
  }

  return { status: "success" };
}
