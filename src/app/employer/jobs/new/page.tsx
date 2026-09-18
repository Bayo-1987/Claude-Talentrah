import Link from "next/link";
import { requireEmployer } from "@/lib/employer/membership";
import { postJobAction } from "@/lib/employer/actions";
import { EyebrowLabel } from "@/components/ui";
import { NewJobForm } from "@/components/employer/new-job-form";
import { NewJobBannerPicker } from "@/components/employer/new-job-banner-picker";
import { NewJobAssessmentFilesPicker } from "@/components/employer/new-job-assessment-files-picker";

export const metadata = { title: "Post a job — Talentrah" };

export default async function NewJobPage() {
  const { organization, userId } = await requireEmployer();

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
        send-364: same placement/reasoning as the banner picker just above —
        an assessment's exercise FILES can't travel through a hidden form
        field either, and staging them here (see
        new-job-assessment-files-picker.tsx) is what makes "upload while
        creating the job" possible at all, closing the gap
        AssessmentExerciseUpload's own header used to point at directly.
      */}
      <div className="mt-6">
        <NewJobAssessmentFilesPicker userId={userId} />
      </div>
      <div className="mt-6">
        <NewJobForm
          action={postJobAction}
          submitLabel="Publish job"
          pendingLabel="Publishing…"
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
