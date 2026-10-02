import Link from "next/link";
import { requireEmployer } from "@/lib/employer/membership";
import { postJobAction } from "@/lib/employer/actions";
import { EyebrowLabel } from "@/components/ui";
import { NewJobForm } from "@/components/employer/new-job-form";
import { NewJobBannerPicker } from "@/components/employer/new-job-banner-picker";
import { getDefaultSalaryCurrency } from "@/lib/employer/default-salary-currency";

export const metadata = { title: "Post a job — Talentrah" };

export default async function NewJobPage() {
  const { organization, userId } = await requireEmployer();
  const defaultSalaryCurrency = await getDefaultSalaryCurrency(userId);

  return (
    <div className="max-w-[820px]">
      <Link
        href="/employer/jobs"
        className="font-body text-[13px] font-semibold text-ink-soft no-underline hover:text-rust"
      >
        ← Jobs Posted
      </Link>
      <div className="mt-4">
        <EyebrowLabel>New role</EyebrowLabel>
        <h1 className="mt-2 font-display text-[30px] leading-[1.15] font-medium text-ink">
          Post a job at {organization.name}
        </h1>
      </div>
      {/*
        send-134: above the form, same placement JobBannerUpload uses on
        Edit — a banner isn't one of the posting's text fields and shouldn't
        be buried below them. Unlike Edit, nothing uploads yet: there's no
        jobId until postJobAction creates one, so this only picks and crops
        the image client-side. The post-success card
        (src/app/employer/jobs/page.tsx's PostSuccessBannerNote) uploads it
        once a real posting exists — see new-job-banner-picker.tsx.
      */}
      <div className="mt-6">
        <NewJobBannerPicker userId={userId} />
      </div>
      {/*
        send-364 staged an assessment's exercise files in a card here, above
        the form. EMP-1 / E4 moved it INTO the form, under the "Attach an
        assessment" checkbox (see AssessmentEditor), so it is visible only
        while that box is ticked; `assessmentCreateContext` below is what
        turns it on.
      */}
      <div className="mt-6">
        <NewJobForm
          action={postJobAction}
          defaultSalaryCurrency={defaultSalaryCurrency}
          assessmentCreateContext={{ userId }}
          submitLabel="Publish job"
          pendingLabel="Publishing…"
          secondarySubmitLabel="Save as draft"
          secondaryPendingLabel="Saving…"
          unverifiedNotice={
            organization.verified
              ? undefined
              : "Your company isn't verified yet, so this job — and any banner you add — will be visible only to your team, not in the public job feed. Add your work-email domain on Company Profile to change that."
          }
        />
      </div>
    </div>
  );
}
