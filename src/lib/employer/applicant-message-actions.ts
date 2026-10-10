"use server";

import { createClient } from "@/lib/supabase/server";
import { requireEmployer } from "@/lib/employer/membership";
import { findMyApplicant, isApplicantOfMyJob } from "@/lib/employer/applicant-messages/authorize";
import { MESSAGE_TEMPLATE_KINDS, type MessageKind } from "@/lib/employer/applicant-messages/constants";
import { sendApplicantMessage } from "@/lib/employer/applicant-messages/send";
import { defaultSendDeps } from "@/lib/employer/applicant-messages/send-deps";
import { runFarahMessageDraft, type DraftMode } from "@/lib/employer/applicant-messages/draft-core";
import { defaultDraftDeps } from "@/lib/employer/applicant-messages/draft-llm";

export type SendApplicantMessageResult = { ok: true; remaining: number } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND = "We couldn't find that applicant. Reload the page and try again.";

/**
 * "Message candidate" (0256): an employer writes to one applicant through Talentrah. Careful lane: it sends email and spends a daily allowance.
 *
 * Only a VERIFIED organisation may send (an unverified one is refused before anything is claimed). Who may call it is decided by the employer's OWN session, twice and independently: requireEmployer() resolves their organisation, and isApplicantOfMyJob asks
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
  // Messages go out from Talentrah's own sending address, so only a VERIFIED company may send them (the platform's trust gate, 0027/0028): an unverified, self-created organisation must not be able to
  // email applicants under Talentrah's name. Nothing is claimed or sent.
  if (!organization.verified) {
    return { ok: false, error: "Verify your company first. Messages to candidates are sent from Talentrah, so only verified companies can send them. You can do this on your Company Profile." };
  }
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

export type DraftApplicantMessageResult =
  | { ok: true; subject: string; body: string }
  | { ok: false; kind: "premium_required" | "insufficient_balance" | "generation_error" | "invalid" | "not_found"; error: string };

/**
 * "Draft/Refine with Farah" on Message candidate (Premium). Same two independent gates as sending (the employer's own session resolves the organisation and the applicant), then the Premium
 * check, the ad wallet debit, the model, and an automatic refund on any failure: see runFarahMessageDraft. It returns TEXT for the employer to review; it cannot send, and this file's send action is
 * a separate call the employer makes by pressing Send. Only the job title, the organisation's name, two first names and what the employer wrote go to the model.
 */
export async function draftApplicantMessageWithFarahAction(input: {
  jobId: string;
  applicationId: string;
  kind: string;
  mode: string;
  notes: string;
  subject: string;
  body: string;
}): Promise<DraftApplicantMessageResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, kind: "not_found", error: "Sign in again to use Farah." };

  const { organization } = await requireEmployer();
  const jobId = typeof input.jobId === "string" ? input.jobId : "";
  const applicationId = typeof input.applicationId === "string" ? input.applicationId : "";
  if (!UUID.test(jobId) || !UUID.test(applicationId)) return { ok: false, kind: "not_found", error: NOT_FOUND };

  const applicant = await findMyApplicant(supabase, { organizationId: organization.id, jobId, applicationId });
  if (!applicant) return { ok: false, kind: "not_found", error: NOT_FOUND };

  const { data: sender } = await supabase.from("profiles").select("first_name").eq("id", user.id).maybeSingle();
  const kind: MessageKind = (MESSAGE_TEMPLATE_KINDS as readonly string[]).includes(input.kind) ? (input.kind as MessageKind) : "custom";
  const mode: DraftMode = input.mode === "refine" ? "refine" : "draft";
  const text = (value: unknown) => (typeof value === "string" ? value : "");

  return runFarahMessageDraft(
    {
      organizationId: organization.id,
      userId: user.id,
      kind,
      mode,
      jobTitle: applicant.jobTitle,
      orgName: organization.name,
      candidateFirstName: applicant.firstName,
      senderFirstName: sender?.first_name ?? null,
      notes: text(input.notes),
      currentSubject: mode === "refine" ? text(input.subject) : "",
      currentBody: mode === "refine" ? text(input.body) : "",
    },
    defaultDraftDeps(),
  );
}
