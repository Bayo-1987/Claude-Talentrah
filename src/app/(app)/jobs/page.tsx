import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { computeAndStoreMatchScores } from "@/lib/matching/compute-and-store";
import { EMPTY_RESUME, type StructuredResume } from "@/lib/resume/types";
import { EyebrowLabel } from "@/components/ui";
import { FeedTabs } from "@/components/jobs/feed-tabs";
import { FilterBar } from "@/components/jobs/filter-bar";
import { JobCard } from "@/components/jobs/job-card";
import { Constants, type Tables } from "@/lib/supabase/types";

export const metadata = { title: "Jobs — Talentrah" };

type SearchParams = Promise<{
  tab?: string;
  workType?: string;
  seniority?: string;
}>;

const VALID_WORK_TYPES: readonly string[] = Constants.public.Enums.work_type;
const VALID_SENIORITIES: readonly string[] = Constants.public.Enums.seniority_level;

export default async function JobsPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, profile } = await requireUser();
  const params = await searchParams;
  const tab = params.tab ?? "recommended";
  type WorkType = NonNullable<Tables<"job_postings">["work_type"]>;
  type Seniority = NonNullable<Tables<"job_postings">["seniority"]>;
  const workType = VALID_WORK_TYPES.includes(params.workType ?? "")
    ? (params.workType as WorkType)
    : undefined;
  const seniority = VALID_SENIORITIES.includes(params.seniority ?? "")
    ? (params.seniority as Seniority)
    : undefined;
  const supabase = await createClient();

  const [{ data: baseResume }, { data: applications }] = await Promise.all([
    supabase
      .from("resumes")
      .select("structured_content")
      .eq("user_id", user.id)
      .eq("is_base", true)
      .maybeSingle(),
    supabase
      .from("applications")
      .select("job_posting_id, stage")
      .eq("user_id", user.id),
  ]);

  const resume = (baseResume?.structured_content as StructuredResume | null) ?? EMPTY_RESUME;
  const applicationByJobId = new Map(
    (applications ?? []).map((a) => [a.job_posting_id, a.stage]),
  );

  let query = supabase.from("job_postings").select("*").eq("status", "open");
  if (tab === "external") query = query.eq("source_type", "external");
  if (workType) query = query.eq("work_type", workType);
  if (seniority) query = query.eq("seniority", seniority);
  if (tab === "saved") {
    const savedIds = [...applicationByJobId.entries()]
      .filter(([, stage]) => stage === "saved")
      .map(([id]) => id);
    query = query.in("id", savedIds.length ? savedIds : ["00000000-0000-0000-0000-000000000000"]);
  }

  const { data: jobsRaw } = await query;
  const jobs: Tables<"job_postings">[] = jobsRaw ?? [];
  if (tab === "recent") {
    jobs.sort((a, b) => new Date(b.posted_at).getTime() - new Date(a.posted_at).getTime());
  }

  const scored = await computeAndStoreMatchScores(supabase, user.id, resume, jobs);
  if (tab !== "recent") {
    scored.sort((a, b) => b.score - a.score);
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <EyebrowLabel>Today&apos;s board</EyebrowLabel>
        <div className="mt-2">
          <FeedTabs active={tab} />
        </div>
      </div>

      <FilterBar tab={tab} workType={workType} seniority={seniority} />

      {scored.length === 0 ? (
        <p className="py-12 text-center text-[14.5px] text-ink-soft">
          {tab === "saved"
            ? "No saved jobs yet — tap the heart icon on a job to save it here."
            : "No jobs match these filters right now — try clearing them."}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {scored.map(({ job, score }) => (
            <JobCard
              key={job.id}
              job={job}
              score={score}
              isSaved={applicationByJobId.get(job.id) === "saved"}
              applicationStage={applicationByJobId.get(job.id) ?? null}
            />
          ))}
        </div>
      )}

      <p className="text-[12px] italic text-ink-soft">
        Match scores are calculated against your saved resume — profile:{" "}
        {profile.first_name}.
      </p>
    </div>
  );
}
