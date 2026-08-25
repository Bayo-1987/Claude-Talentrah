import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireEmployer } from "@/lib/employer/membership";
import { BorderedCard, EyebrowLabel, buttonClasses } from "@/components/ui";
import { PostedJobRow, type PostedJob } from "@/components/employer/posted-job-row";

export const metadata = { title: "Jobs Posted — Talentrah" };

export default async function JobsPostedPage() {
  const { organization } = await requireEmployer();
  const supabase = await createClient();

  const [{ data: jobs, error: jobsError }, { data: counts, error: countsError }] =
    await Promise.all([
      supabase
        .from("job_postings")
        .select("id, title, location, status, posted_at, work_type, employment_type")
        .eq("organization_id", organization.id)
        .eq("source_type", "internal")
        .order("posted_at", { ascending: false }),
      // Counts cannot come from a join: `applications` is owner-only under RLS,
      // so an employer reading it directly gets zero rows and would see "0
      // applications" on every posting — wrong, and silently so. Migration 0029
      // exists for exactly this, and returns counts without applicant identity.
      supabase.rpc("org_application_counts", { p_organization_id: organization.id }),
    ]);

  if (jobsError) {
    throw new Error(`Couldn't load your job postings: ${jobsError.message}`);
  }

  const countByJob = new Map<string, number>(
    (counts ?? []).map((row) => [row.job_posting_id, Number(row.application_count)]),
  );

  const rows: PostedJob[] = (jobs ?? []).map((job) => ({
    id: job.id,
    title: job.title,
    location: job.location,
    status: job.status,
    postedAt: job.posted_at,
    workType: job.work_type,
    employmentType: job.employment_type,
    applicationCount: countByJob.get(job.id) ?? 0,
  }));

  const openCount = rows.filter((r) => r.status === "open").length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <EyebrowLabel>{organization.name}</EyebrowLabel>
          <h1 className="mt-2 font-display text-[30px] leading-[1.15] font-medium text-ink">
            Jobs Posted
          </h1>
          <p className="mt-1.5 font-body text-[14px] text-ink-soft">
            {rows.length === 0
              ? "Nothing posted yet."
              : `${openCount} open · ${rows.length} total`}
          </p>
        </div>
        <Link href="/employer/jobs/new" className={buttonClasses("primary", "md", "no-underline")}>
          Post a job
        </Link>
      </div>

      {/*
        The verification state is stated on the page an employer actually looks
        at, not buried in a settings screen. An unverified company whose jobs
        silently never appear in the feed is the worst version of this gate —
        it looks like the product is broken rather than like there is a step
        left to take.
      */}
      {!organization.verified && (
        <p className="border-[1.5px] border-amber bg-[oklch(96%_0.03_70)] px-4 py-3 text-[13.5px] text-ink">
          <span className="font-semibold">{organization.name} isn&apos;t verified yet.</span> Your
          jobs are saved and visible to your team, but they don&apos;t appear in the public job feed
          until the company is verified.{" "}
          <Link href="/employer/profile" className="font-semibold text-rust underline underline-offset-2">
            Add your work-email domain
          </Link>
          .
        </p>
      )}

      {countsError && (
        <p className="border-[1.5px] border-rust bg-rust-soft px-4 py-3 text-[13.5px] text-rust">
          Couldn&apos;t load application counts, so the numbers below aren&apos;t reliable right
          now. The postings themselves are fine.
        </p>
      )}

      {rows.length === 0 ? (
        <BorderedCard className="p-8 text-center">
          <p className="font-display text-[20px] font-medium text-ink">
            Post your first role
          </p>
          <p className="mx-auto mt-2 max-w-[46ch] font-body text-[14px] text-ink-soft">
            Seekers are matched against your description automatically — you don&apos;t need to
            tag skills by hand.
          </p>
          <div className="mt-5">
            <Link href="/employer/jobs/new" className={buttonClasses("primary", "md", "no-underline")}>
              Post a job
            </Link>
          </div>
        </BorderedCard>
      ) : (
        <div className="flex flex-col gap-3.5">
          {rows.map((job) => (
            <PostedJobRow key={job.id} job={job} orgVerified={organization.verified} />
          ))}
        </div>
      )}
    </div>
  );
}
