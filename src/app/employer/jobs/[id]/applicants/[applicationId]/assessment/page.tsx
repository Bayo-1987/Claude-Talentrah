import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireEmployer } from "@/lib/employer/membership";
import { loadAssessmentResponse } from "@/lib/employer/assessment-response";
import { AssessmentResponseView } from "@/components/employer/assessment-response-view";
import { EmployerPrintButton } from "@/components/employer/employer-print-button";
import { EyebrowLabel } from "@/components/ui";

export const metadata = { title: "Assessment response — Talentrah", robots: { index: false, follow: false, noarchive: true } };

/**
 * An applicant's assessment response, in the page, the way "View resume" shows the resume (ASSESSMENT-VIEWER-1). Same two independent gates as the resume page: `requireEmployer()` for the organisation (a
 * signed-out visitor is sent to log in, exactly as on View resume), then `loadAssessmentResponse`, which asks through the employer's OWN session whether this is one of the organisation's applicants on THIS job. A foreign
 * organisation, another job's application and a made-up id all get the app's not-found page. Private like the other employer pages: it reads the session (so it is rendered per request, never shared between
 * users), and /employer is disallowed in robots.ts. No applicant email or phone is read.
 */
export default async function ApplicantAssessmentPage({ params }: { params: Promise<{ id: string; applicationId: string }> }) {
  const { id: jobId, applicationId } = await params;
  const { organization } = await requireEmployer();
  const supabase = await createClient();

  const result = await loadAssessmentResponse(supabase, { organizationId: organization.id, jobId, applicationId });
  if (result.status === "not_found") notFound();

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/employer/jobs/${jobId}/applicants`} className="font-body text-[13px] font-semibold text-ink-soft no-underline hover:text-rust">
          ← Applicants · {result.jobTitle}
        </Link>
        {result.status === "ok" && <EmployerPrintButton applicantName={result.applicantName} kind="assessment" />}
      </div>
      <EyebrowLabel>Assessment response</EyebrowLabel>
      {result.status === "ok" && <AssessmentResponseView applicantName={result.applicantName} jobTitle={result.jobTitle} submission={result.submission} />}
      {result.status === "no_assessment" && (
        <p role="status" className="font-body text-[14px] text-ink-soft">
          This job has no assessment, so there is no response to show.
        </p>
      )}
      {result.status === "no_submission" && (
        <p role="status" className="font-body text-[14px] text-ink-soft">
          {result.applicantName} has not submitted an assessment response yet.
        </p>
      )}
    </div>
  );
}
