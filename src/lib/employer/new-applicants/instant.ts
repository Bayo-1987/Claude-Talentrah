import { absoluteUrl } from "@/lib/seo/site";
import { buildInstantEmail } from "./emails";

export interface Recipient {
  userId: string;
  email: string;
  firstName: string | null;
  mode: string;
}

export interface InstantDeps {
  /** claim_applicant_instant (0254): only the FIRST (non-QA) applicant of a job, and only once. Null = nothing to announce. */
  claim(applicationId: string): Promise<{ jobId: string; organizationId: string } | null>;
  /** new_applicant_recipients (0254): members who may be emailed (not deleting, has an address, not 'off', not QA). */
  recipients(organizationId: string): Promise<Recipient[]>;
  context(applicationId: string, jobId: string): Promise<{ applicantName: string; jobTitle: string } | null>;
  /** true = the provider accepted it. */
  send(p: { to: string; subject: string; text: string; html: string }): Promise<boolean>;
  /** release_applicant_instant (0254): hands the claim back so the next digest carries the applicant. */
  release(applicationId: string): Promise<void>;
}

export type InstantResult = { status: "not_first" | "no_recipients" | "sent" | "failed"; sent: number };

/**
 * The instant email for the first applicant of a job, sent right after the application is recorded (run in `after()`, never on the applicant's path). The database decides who is "first" and
 * claims the email exactly once; this sends to the members on 'instant' only, keeps the claim if at least one email went out, and RELEASES it if none did, so the applicant still shows up in the
 * next digest. Never throws. The email carries the applicant's name, the job and a link, nothing else.
 */
export async function notifyFirstApplicant(applicationId: string, deps: InstantDeps): Promise<InstantResult> {
  let claimed: { jobId: string; organizationId: string } | null;
  try {
    claimed = await deps.claim(applicationId);
  } catch (error) {
    console.error("[new-applicant-instant] could not claim:", error instanceof Error ? error.message : "unknown error");
    return { status: "failed", sent: 0 };
  }
  if (!claimed) return { status: "not_first", sent: 0 };

  async function giveBack(reason: string): Promise<InstantResult> {
    console.error(`[new-applicant-instant] ${reason} for application ${applicationId}: the claim is released`);
    await deps.release(applicationId).catch(() => {});
    return { status: "failed", sent: 0 };
  }

  try {
    const recipients = (await deps.recipients(claimed.organizationId)).filter((r) => r.mode === "instant");
    if (recipients.length === 0) return { status: "no_recipients", sent: 0 };

    const context = await deps.context(applicationId, claimed.jobId);
    if (!context) return await giveBack("no context");

    const email = buildInstantEmail({
      applicantName: context.applicantName,
      jobTitle: context.jobTitle,
      applicantsUrl: absoluteUrl(`/employer/jobs/${claimed.jobId}/applicants`),
      settingsUrl: absoluteUrl("/employer/jobs"),
    });

    let sent = 0;
    for (const recipient of recipients) {
      try {
        if (await deps.send({ to: recipient.email, subject: email.subject, text: email.text, html: email.html })) sent += 1;
      } catch {
        // counted as not sent; the provider's error can quote the address, so it is not logged
      }
    }
    if (sent === 0) return await giveBack("every send failed");
    return { status: "sent", sent };
  } catch {
    return await giveBack("an unexpected error");
  }
}
