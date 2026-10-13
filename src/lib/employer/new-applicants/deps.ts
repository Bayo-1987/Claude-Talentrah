import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getResendClient } from "@/lib/resend/client";
import type { DigestDeps } from "./digest";
import type { InstantDeps, Recipient } from "./instant";

const FROM = "Talentrah <notifications@talentrah.com>";

const fullName = (first: string | null, last: string | null) => [first, last].map((p) => p?.trim()).filter(Boolean).join(" ");

async function sendMail(p: { to: string; subject: string; text: string; html: string }): Promise<boolean> {
  const resend = getResendClient();
  if (!resend) {
    console.error("[new-applicants] RESEND_API_KEY is not set: nothing was sent");
    return false;
  }
  const { error } = await resend.emails.send({ from: FROM, ...p });
  return !error;
}

async function loadRecipients(organizationId: string): Promise<Recipient[]> {
  const { data, error } = await createServiceRoleClient().rpc("new_applicant_recipients", { p_organization: organizationId });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ userId: r.user_id, email: r.email, firstName: r.first_name, mode: r.mode }));
}

/** The real dependencies of the instant email: the 0254 functions with the service role, the shared deletion-guarded Resend client. */
export function defaultInstantDeps(): InstantDeps {
  const admin = createServiceRoleClient();
  return {
    async claim(applicationId) {
      const { data, error } = await admin.rpc("claim_applicant_instant", { p_application: applicationId });
      if (error) throw new Error(error.message);
      const row = data?.[0];
      return row ? { jobId: row.job_posting_id, organizationId: row.organization_id } : null;
    },
    recipients: loadRecipients,
    async context(applicationId, jobId) {
      const { data: application } = await admin.from("applications").select("user_id, job_posting_id").eq("id", applicationId).maybeSingle();
      if (!application || application.job_posting_id !== jobId) return null;
      const [{ data: profile }, { data: job }] = await Promise.all([
        admin.from("profiles").select("first_name, last_name").eq("id", application.user_id).maybeSingle(),
        admin.from("job_postings").select("title").eq("id", jobId).maybeSingle(),
      ]);
      if (!job) return null;
      return { applicantName: fullName(profile?.first_name ?? null, profile?.last_name ?? null), jobTitle: job.title };
    },
    send: sendMail,
    async release(applicationId) {
      const { error } = await admin.rpc("release_applicant_instant", { p_application: applicationId });
      if (error) throw new Error(error.message);
    },
  };
}

/** The real dependencies of the daily digest. */
export function defaultDigestDeps(): DigestDeps {
  const admin = createServiceRoleClient();
  return {
    async claim(until) {
      const { data, error } = await admin.rpc("claim_applicant_digest", { p_until: until.toISOString() });
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({
        notificationId: r.notification_id,
        applicationId: r.application_id,
        jobId: r.job_posting_id,
        organizationId: r.organization_id,
        isFirst: r.is_first,
        alreadyAnnounced: r.already_announced,
      }));
    },
    async release(notificationIds) {
      const { error } = await admin.rpc("release_applicant_digest", { p_ids: notificationIds });
      if (error) throw new Error(error.message);
    },
    recipients: loadRecipients,
    async names(applicationIds) {
      const { data: apps, error } = await admin.from("applications").select("id, user_id").in("id", applicationIds);
      if (error) throw new Error(error.message);
      const userIds = [...new Set((apps ?? []).map((a) => a.user_id))];
      const { data: profiles, error: profileError } = await admin.from("profiles").select("id, first_name, last_name").in("id", userIds);
      if (profileError) throw new Error(profileError.message);
      const byUser = new Map((profiles ?? []).map((p) => [p.id, fullName(p.first_name, p.last_name)]));
      return new Map((apps ?? []).map((a) => [a.id, byUser.get(a.user_id) ?? ""]));
    },
    async jobTitles(jobIds) {
      const { data, error } = await admin.from("job_postings").select("id, title").in("id", jobIds);
      if (error) throw new Error(error.message);
      return new Map((data ?? []).map((j) => [j.id, j.title]));
    },
    send: sendMail,
  };
}
