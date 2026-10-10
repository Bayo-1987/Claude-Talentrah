import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getResendClient } from "@/lib/resend/client";
import type { SendDeps } from "./send";

/**
 * The real dependencies of sendApplicantMessage: the service role for everything the employer's own session must not be able to do (read the candidate's address,
 * claim a slot, mark a message), and the shared, deletion-guarded Resend client. The candidate's address is read in loadRecipient and handed to `deliver`; it is never returned to a caller.
 */
export function defaultSendDeps(): SendDeps {
  const admin = createServiceRoleClient();

  return {
    async loadRecipient({ applicationId, jobId, organizationId }) {
      const { data: application } = await admin
        .from("applications")
        .select("id, user_id, job_posting_id, applied_at")
        .eq("id", applicationId)
        .maybeSingle();
      // The application must be a SUBMITTED one on exactly this job (a saved bookmark is not an applicant).
      if (!application || application.job_posting_id !== jobId || !application.applied_at) return null;

      const { data: job } = await admin.from("job_postings").select("id, title, organization_id").eq("id", jobId).maybeSingle();
      if (!job || job.organization_id !== organizationId) return null;

      const [{ data: org }, { data: profile }] = await Promise.all([
        admin.from("organizations").select("name").eq("id", organizationId).maybeSingle(),
        admin.from("profiles").select("email, first_name, deletion_requested_at").eq("id", application.user_id).maybeSingle(),
      ]);
      if (!org || !profile) return null;

      return {
        userId: application.user_id,
        email: profile.email,
        firstName: profile.first_name,
        deletionRequestedAt: profile.deletion_requested_at,
        jobTitle: job.title,
        orgName: org.name,
      };
    },

    async claim(p) {
      const { data, error } = await admin.rpc("claim_applicant_message", {
        p_organization_id: p.organizationId,
        p_application_id: p.applicationId,
        p_job_posting_id: p.jobId,
        p_sender_user_id: p.senderUserId,
        p_kind: p.kind,
        p_subject: p.subject,
        p_body: p.body,
      });
      if (error) throw new Error(error.message);
      return data;
    },

    async deliver({ to, replyTo, fromName, subject, text, html }) {
      const resend = getResendClient();
      if (!resend) {
        console.error("[applicant-message] RESEND_API_KEY is not set: the message was not sent");
        return false;
      }
      const { error } = await resend.emails.send({
        from: `${fromName} <notifications@talentrah.com>`,
        to,
        replyTo,
        subject,
        text,
        html,
      });
      return !error;
    },

    async markSent(messageId) {
      const { error } = await admin
        .from("applicant_messages")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", messageId)
        .eq("status", "claimed");
      if (error) throw new Error(error.message);
    },

    async markFailed(messageId, reason) {
      const { error } = await admin
        .from("applicant_messages")
        .update({ status: "failed", failure_reason: reason })
        .eq("id", messageId)
        .eq("status", "claimed");
      if (error) throw new Error(error.message);
    },

    async notifyCandidate({ userId, title, body, link }) {
      const { error } = await admin.from("user_notifications").insert({ user_id: userId, type: "employer_message", title, body, link });
      if (error) throw new Error(error.message);
    },

    async countToday(organizationId) {
      const now = new Date();
      const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
      const { count, error } = await admin
        .from("applicant_messages")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .in("status", ["claimed", "sent"])
        .gte("created_at", dayStart);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  };
}
