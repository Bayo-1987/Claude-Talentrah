"use server";

import { createClient } from "@/lib/supabase/server";
import { requireEmployer } from "@/lib/employer/membership";
import { isApplicantOfMyJob } from "@/lib/employer/applicant-messages/authorize";
import { MESSAGE_TEMPLATE_KINDS, type MessageKind } from "@/lib/employer/applicant-messages/constants";
import { sendApplicantMessage } from "@/lib/employer/applicant-messages/send";
import { defaultSendDeps } from "@/lib/employer/applicant-messages/send-deps";

export type SendApplicantMessageResult = { ok: true; remaining: number } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND = "We couldn't find that applicant. Reload the page and try again.";

/**
 * "Message candidate" (0256): an employer writes to one applicant through Talentrah. Careful lane: it sends email and spends a daily allowance.
 *
 * Who may call it is decided by the employer's OWN session, twice and independently: requireEmployer() resolves their organisation, and isApplicantOfMyJob asks
 * employer_job_applicants (its own membership check) whether this application is a submitted one on a job that organisation owns. Only then does the send run with the service role,
 * and the candidate's address stays inside it: the result carries a count or a message, never an address. The `kind` a browser sends can only be one of the three templates or 'custom':
 * 'interview_invite' belongs to the scheduling flow and cannot be claimed from here.
 */
export async function sendApplicantMessageAction(input: {
  jobId: string;
  applicationId: string;
  kind: string;
  subject: string;
  body: string;
}): Promise<SendApplicantMessageResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in again to send a message." };

  const { organization, emailConfirmed } = await requireEmployer();
  if (!emailConfirmed) {
    return { ok: false, error: "Confirm your email address first: replies to this message will come to it." };
  }

  const jobId = typeof input.jobId === "string" ? input.jobId : "";
  const applicationId = typeof input.applicationId === "string" ? input.applicationId : "";
  if (!UUID.test(jobId) || !UUID.test(applicationId)) return { ok: false, error: NOT_FOUND };

  const kind: MessageKind = (MESSAGE_TEMPLATE_KINDS as readonly string[]).includes(input.kind) ? (input.kind as MessageKind) : "custom";

  if (!(await isApplicantOfMyJob(supabase, { organizationId: organization.id, jobId, applicationId }))) {
    return { ok: false, error: NOT_FOUND };
  }

  const result = await sendApplicantMessage(
    {
      organizationId: organization.id,
      jobId,
      applicationId,
      senderUserId: user.id,
      senderEmail: user.email ?? null,
      kind,
      subject: input.subject,
      body: input.body,
    },
    defaultSendDeps(),
  );
  return result.ok ? { ok: true, remaining: result.remaining } : { ok: false, error: result.message };
}
