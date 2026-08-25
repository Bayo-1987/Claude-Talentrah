import Link from "next/link";
import { requireEmployer } from "@/lib/employer/membership";
import { postJobAction } from "@/lib/employer/actions";
import { EyebrowLabel } from "@/components/ui";
import { JobPostingForm } from "@/components/employer/job-posting-form";

export const metadata = { title: "Post a job — Talentrah" };

export default async function NewJobPage() {
  const { organization } = await requireEmployer();

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
      <div className="mt-6">
        <JobPostingForm
          action={postJobAction}
          submitLabel="Publish job"
          pendingLabel="Publishing…"
          unverifiedNotice={
            organization.verified
              ? undefined
              : "Your company isn't verified yet, so this job will be visible only to your team — not in the public job feed. Add your work-email domain on Company Profile to change that."
          }
        />
      </div>
    </div>
  );
}
