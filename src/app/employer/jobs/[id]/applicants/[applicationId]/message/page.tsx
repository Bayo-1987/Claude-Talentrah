import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireEmployer } from "@/lib/employer/membership";
import { findMyApplicant } from "@/lib/employer/applicant-messages/authorize";
import { buildTemplate } from "@/lib/employer/applicant-messages/templates";
import { MESSAGE_TEMPLATE_KINDS, DAILY_MESSAGE_LIMIT } from "@/lib/employer/applicant-messages/constants";
import { defaultSendDeps } from "@/lib/employer/applicant-messages/send-deps";
import { employerHasPremium } from "@/lib/employer/premium";
import { FARAH_MESSAGE_DRAFT_NGN } from "@/lib/billing/catalog";
import { MessageCandidateForm, type TemplateTexts } from "@/components/employer/message-candidate-form";
import { EyebrowLabel } from "@/components/ui";

export const metadata = { title: "Message candidate — Talentrah" };

/**
 * Write to one applicant through Talentrah (0256). Same two independent gates as the resume page: requireEmployer() for the organisation, then employer_job_applicants (through the
 * employer's own session) for "this is a submitted application on a job this organisation owns". Anything else is a 404, never a hint that the application exists elsewhere. The candidate's
 * email is never read on this page: the form shows their name and where REPLIES go (the signed-in employer's own address).
 */
export default async function MessageCandidatePage({ params }: { params: Promise<{ id: string; applicationId: string }> }) {
  const { id: jobId, applicationId } = await params;
  const { organization, userEmail, userId } = await requireEmployer();
  const supabase = await createClient();

  const applicant = await findMyApplicant(supabase, { organizationId: organization.id, jobId, applicationId });
  if (!applicant) notFound();

  const [{ data: sender }, used, premium] = await Promise.all([
    supabase.from("profiles").select("first_name").eq("id", userId).maybeSingle(),
    defaultSendDeps().countToday(organization.id).catch(() => 0),
    employerHasPremium(organization.id),
  ]);

  const templates = Object.fromEntries(
    MESSAGE_TEMPLATE_KINDS.map((kind) => [
      kind,
      buildTemplate(kind, {
        candidateFirstName: applicant.firstName,
        jobTitle: applicant.jobTitle,
        orgName: organization.name,
        senderFirstName: sender?.first_name ?? null,
      }),
    ]),
  ) as TemplateTexts;

  const candidateName = [applicant.firstName, applicant.lastName].filter(Boolean).join(" ") || "this candidate";
  const backHref = `/employer/jobs/${jobId}/applicants`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={backHref} className="font-body text-[13px] font-semibold text-ink-soft no-underline hover:text-rust">
          ← Applicants · {applicant.jobTitle}
        </Link>
        <div className="mt-4">
          <EyebrowLabel>Message candidate</EyebrowLabel>
        </div>
      </div>
      <MessageCandidateForm
        jobId={jobId}
        applicationId={applicationId}
        candidateName={candidateName}
        jobTitle={applicant.jobTitle}
        orgName={organization.name}
        replyTo={userEmail ?? ""}
        templates={templates}
        remainingToday={Math.max(0, DAILY_MESSAGE_LIMIT - used)}
        backHref={backHref}
        premium={premium}
        farahPriceNgn={FARAH_MESSAGE_DRAFT_NGN}
      />
    </div>
  );
}
