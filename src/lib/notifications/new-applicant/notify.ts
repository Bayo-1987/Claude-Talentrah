import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { NOTIFICATION_FLAGS } from "../contract";
import { claimNotification, releaseNotification } from "../contract-db";
import { pushIfAllowed, realPushGateDeps, type PushGateDeps } from "./push-gates";

/**
 * U5, the first event: an employer's organisation has a new applicant.
 *
 * Called from ONE place, after the application is recorded and after the response (src/lib/applications/actions.ts, inside the existing after() block beside the instant email). It never throws.
 *
 *   - Who counts: the database already decided. A notice row exists only for an internal job's non-QA applicant, and says whether this applicant is the job's first. No row means nobody is told.
 *   - The inbox: one row per eligible recipient (a member who may be contacted, not scheduled for deletion, not QA, not "off") per applicant, exactly once (a claim keyed on the application makes a
 *     repeat call write nothing). Gated by notifications_master only; the push switch does not decide whether the inbox row exists.
 *   - The push: only for the job's FIRST applicant, only to recipients on "instant", only through the gates in push-gates.ts. The delivery step's claim is keyed on the JOB, so a second applicant
 *     finds the claim already taken even if something upstream called it first too.
 *   - Generic text: the push carries no name, job title, company, score or status. Nothing here reads an applicant's status.
 */
export type NewApplicantNotice = { jobId: string; organizationId: string; isFirst: boolean };
export type NewApplicantRecipient = { userId: string; mode: string };

export type NewApplicantDeps = PushGateDeps & {
  notice(applicationId: string): Promise<NewApplicantNotice | null>;
  recipients(organizationId: string): Promise<NewApplicantRecipient[]>;
  /** The inbox claim for (recipient, application): an id, or null when that row was already made. */
  claimInbox(userId: string, applicationId: string): Promise<string | null>;
  writeInbox(userId: string, jobId: string, applicationId: string): Promise<boolean>;
  releaseInbox(claimId: string): Promise<void>;
};

const INBOX_TITLE = "New applicant";
const INBOX_BODY = "Someone applied to one of your jobs. Open the applicants page to see who.";

export async function notifyNewApplicantWith(applicationId: string, deps: NewApplicantDeps): Promise<void> {
  try {
    let masterOn = false;
    try {
      masterOn = (await deps.flagOn(NOTIFICATION_FLAGS.master)) === true;
    } catch {
      masterOn = false;
    }
    if (!masterOn) return;

    const notice = await deps.notice(applicationId);
    if (!notice) return;
    const recipients = await deps.recipients(notice.organizationId);
    const applicantsUrl = `/employer/jobs/${notice.jobId}/applicants`;

    for (const recipient of recipients) {
      try {
        const claimId = await deps.claimInbox(recipient.userId, applicationId);
        if (claimId) {
          const written = await deps.writeInbox(recipient.userId, notice.jobId, applicationId).then(
            (ok) => ok,
            () => false,
          );
          if (!written) await deps.releaseInbox(claimId).catch(() => undefined);
        }
      } catch {
        // one recipient's inbox failing never stops the next recipient
      }
      if (notice.isFirst && recipient.mode === "instant") {
        await pushIfAllowed(deps, { userId: recipient.userId, kind: "new_applicant", subject: notice.jobId, url: applicantsUrl });
      }
    }
  } catch (error) {
    console.error("[new-applicant-notify] could not notify:", error instanceof Error ? error.message : "unknown error");
  }
}

function realDeps(): NewApplicantDeps {
  const client = createServiceRoleClient();
  return {
    ...realPushGateDeps(client),
    notice: async (applicationId) => {
      const { data, error } = await client
        .from("employer_applicant_notifications")
        .select("job_posting_id, organization_id, is_first, suppressed_reason")
        .eq("application_id", applicationId)
        .maybeSingle();
      if (error) throw new Error("new-applicant: the notice could not be read");
      if (!data || data.suppressed_reason !== null) return null;
      return { jobId: data.job_posting_id, organizationId: data.organization_id, isFirst: data.is_first };
    },
    recipients: async (organizationId) => {
      const { data, error } = await client.rpc("new_applicant_recipients", { p_organization: organizationId });
      if (error) throw new Error("new-applicant: the recipients could not be read");
      return (data ?? []).map((r) => ({ userId: r.user_id, mode: r.mode }));
    },
    claimInbox: async (userId, applicationId) => (await claimNotification(client, { p_user: userId, p_kind: "new_applicant", p_subject: applicationId, p_channel: "inapp" })).id,
    writeInbox: async (userId, jobId) => {
      const { error } = await client.from("user_notifications").insert({ user_id: userId, type: "new_applicant", title: INBOX_TITLE, body: INBOX_BODY, link: `/employer/jobs/${jobId}/applicants` });
      return !error;
    },
    releaseInbox: (claimId) => releaseNotification(client, { p_id: claimId, p_reason: "pre_send_failure" }),
  };
}

/** The hook's entry point. Builds the real dependencies and never throws, even if that fails. */
export async function notifyNewApplicant(applicationId: string): Promise<void> {
  try {
    await notifyNewApplicantWith(applicationId, realDeps());
  } catch (error) {
    console.error("[new-applicant-notify] could not start:", error instanceof Error ? error.message : "unknown error");
  }
}
