import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireEmployer } from "@/lib/employer/membership";
import { findMyApplicant } from "@/lib/employer/applicant-messages/authorize";
import { loadEmployerScheduleState } from "@/lib/interviews/read";
import { KIND_LABELS, isInterviewKind } from "@/lib/interviews/constants";
import { ScheduleInterviewForm } from "@/components/interviews/schedule-interview-form";
import { ResendInvitationButton } from "@/components/interviews/resend-invitation-button";
import { LocalTime } from "@/components/interviews/local-time";
import { EyebrowLabel } from "@/components/ui";

export const metadata = { title: "Schedule interview — Talentrah" };

/**
 * Offer interview times to one applicant (0253). The same two independent gates as the resume and Message candidate pages: requireEmployer() for the organisation, then employer_job_applicants through the
 * employer's own session for "a submitted application on a job this organisation owns"; anything else is the not-found page. What is shown (the open offer, the booked time) is read with the service role only after that.
 */
export default async function ScheduleInterviewPage({ params }: { params: Promise<{ id: string; applicationId: string }> }) {
  const { id: jobId, applicationId } = await params;
  const { organization } = await requireEmployer();
  const supabase = await createClient();

  const applicant = await findMyApplicant(supabase, { organizationId: organization.id, jobId, applicationId });
  if (!applicant) notFound();

  const state = await loadEmployerScheduleState(applicationId);
  const candidateName = [applicant.firstName, applicant.lastName].filter(Boolean).join(" ") || "this candidate";
  const backHref = `/employer/jobs/${jobId}/applicants`;
  const booked = state.booking?.status === "booked" ? state.booking : null;
  const cancelled = state.booking?.status === "cancelled" ? state.booking : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={backHref} className="font-body text-[13px] font-semibold text-ink-soft no-underline hover:text-rust">
          ← Applicants · {applicant.jobTitle}
        </Link>
        <div className="mt-4">
          <EyebrowLabel>Schedule interview</EyebrowLabel>
        </div>
      </div>

      {booked ? (
        <div className="border-[1.5px] border-ink bg-card p-6 sm:p-8">
          <h1 className="font-display text-[28px] leading-[1.15] font-medium text-ink">Interview scheduled with {candidateName}</h1>
          <p className="mt-3 font-body text-[16px] text-ink">
            <LocalTime startsAt={booked.startsAt} durationMinutes={booked.durationMinutes} />
          </p>
          <p className="mt-2 font-body text-[13.5px] text-ink-soft">Shown in your own time zone. Both of you were emailed a calendar file.</p>
        </div>
      ) : state.open ? (
        <div className="border-[1.5px] border-ink bg-card p-6 sm:p-8">
          <h1 className="font-display text-[28px] leading-[1.15] font-medium text-ink">Waiting for {candidateName} to choose</h1>
          <p className="mt-2 font-body text-[14px] text-ink-soft">
            {isInterviewKind(state.open.kind) ? KIND_LABELS[state.open.kind] : state.open.kind}. Offered times, in your own time zone:
          </p>
          <ul className="mt-3 flex flex-col gap-1.5 font-body text-[15px] text-ink">
            {state.open.slots.map((slot) => (
              <li key={slot.id}>
                <LocalTime startsAt={slot.startsAt} durationMinutes={slot.durationMinutes} />
              </li>
            ))}
          </ul>
          {state.open.state !== "open" && (
            <p className="mt-4 font-body text-[13.5px] text-rust">
              This invitation is no longer open ({{ closed_job: "the job is not open", closed_rejected: "the applicant was marked not a fit or hired", closed_deleted: "the applicant is deleting their account", expired: "every offered time has passed" }[state.open.state] ?? "it was closed"}).
            </p>
          )}
          <div className="mt-6">
            <ResendInvitationButton jobId={jobId} applicationId={applicationId} />
          </div>
        </div>
      ) : (
        <>
          {cancelled && (
            <p role="status" className="border-[1.5px] border-ink bg-paper-alt px-4 py-3 font-body text-[14px] text-ink">
              The interview that was booked for <LocalTime startsAt={cancelled.startsAt} durationMinutes={cancelled.durationMinutes} /> was cancelled.
            </p>
          )}
          <ScheduleInterviewForm jobId={jobId} applicationId={applicationId} candidateName={candidateName} orgVerified={organization.verified} />
        </>
      )}
    </div>
  );
}
