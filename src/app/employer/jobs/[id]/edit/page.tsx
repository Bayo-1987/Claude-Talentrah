import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireEmployer } from "@/lib/employer/membership";
import { updateJobAction } from "@/lib/employer/actions";
import { EyebrowLabel } from "@/components/ui";
import { JobPostingForm } from "@/components/employer/job-posting-form";
import { JobBannerUpload } from "@/components/employer/job-banner-upload";
import { bannerPublicUrl } from "@/lib/employer/banner";

export const metadata = { title: "Edit job — Talentrah" };

export default async function EditJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { organization } = await requireEmployer();
  const supabase = await createClient();

  // Scoped to the org as well as the id. RLS would already stop a write to
  // someone else's posting, but reading one and rendering it into an edit form
  // would leak its contents before the write was ever attempted.
  const { data: job } = await supabase
    .from("job_postings")
    .select("*")
    .eq("id", id)
    .eq("organization_id", organization.id)
    .maybeSingle();

  if (!job) notFound();

  return (
    <div className="max-w-[820px]">
      <Link
        href="/employer/jobs"
        className="font-body text-[13px] font-semibold text-ink-soft no-underline hover:text-rust"
      >
        ← Jobs Posted
      </Link>
      <div className="mt-4">
        <EyebrowLabel>Editing</EyebrowLabel>
        <h1 className="mt-2 font-display text-[30px] leading-[1.15] font-medium text-ink">
          {job.title}
        </h1>
      </div>
      {/*
        Above the form because it is the one field that is not part of the
        posting's text, and because an employer arriving to add a banner should
        not have to scroll past every other field to find it.

        This preview does NOT apply the public visibility gate: it is the
        owner's own edit screen and showing them their own artwork is the
        point. Whether the PUBLIC page renders it is a different question,
        answered on the detail page and explained in the notice inside this
        card when the answer is currently no.
      */}
      <div className="mt-6">
        <JobBannerUpload
          jobId={job.id}
          organizationVerified={organization.verified}
          currentBannerUrl={bannerPublicUrl({
            supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
            bannerPath: job.banner_path,
            organizationId: job.organization_id,
          })}
        />
      </div>
      <div className="mt-6">
        <JobPostingForm
          action={updateJobAction.bind(null, job.id)}
          submitLabel="Save changes"
          pendingLabel="Saving…"
          initial={{
            title: job.title,
            location: job.location ?? "",
            description: job.description,
            workType: job.work_type,
            employmentType: job.employment_type,
            seniority: job.seniority,
            yearsExperienceMin: job.years_experience_min,
            expiresAt: job.expires_at,
            salaryMin: job.salary_min,
            salaryMax: job.salary_max,
            salaryCurrency: job.salary_currency,
            salaryUnit: job.salary_unit,
          }}
        />
      </div>
    </div>
  );
}
