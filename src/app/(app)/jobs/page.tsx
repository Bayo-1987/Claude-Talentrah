import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { computeAndStoreMatchScores } from "@/lib/matching/compute-and-store";
import { scanAndQueue } from "@/lib/auto-apply/queue";
import { AutoApplyToggle } from "@/components/jobs/auto-apply-toggle";
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

  const [{ data: baseResume, error: baseResumeError }, { data: applications }] = await Promise.all([
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

  // Only fall back to an empty resume when there genuinely isn't one yet
  // (a real, expected state for a new user). A query error is a different
  // situation — silently scoring against an empty resume there would look
  // identical to "no resume" but actually mean something is broken (this is
  // exactly how QA audit bug #1 went unnoticed: a duplicate is_base row
  // made this query error, and match scores quietly went wrong with no
  // visible sign anything was off). The DB now also structurally prevents
  // that specific duplicate (migration 0010), but this distinction stays
  // worth keeping regardless of cause.
  const hasBaseResume = !baseResumeError && !!baseResume;
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
      .filter(([id, stage]) => id !== null && stage === "saved")
      .map(([id]) => id as string);
    query = query.in("id", savedIds.length ? savedIds : ["00000000-0000-0000-0000-000000000000"]);
  }

  const { data: jobsRaw } = await query;
  const jobs: Tables<"job_postings">[] = jobsRaw ?? [];
  if (tab === "recent") {
    jobs.sort((a, b) => new Date(b.posted_at).getTime() - new Date(a.posted_at).getTime());
  }

  const scored = await computeAndStoreMatchScores(supabase, user.id, resume, jobs);

  /*
   * Auto-Apply scans AFTER scoring, on purpose: the scan reads `match_scores`,
   * so running it first would queue against last visit's scores. It is also
   * why this lives on the feed rather than a cron — the scores it depends on
   * are recomputed here, and nowhere else.
   *
   * Failure is swallowed deliberately. Auto-Apply is an accessory to the feed;
   * a queueing error must not take the job board down with it.
   */
  const [{ data: autoApplySettings }, pendingQueue] = await Promise.all([
    supabase.from("auto_apply_settings").select("enabled").eq("user_id", user.id).maybeSingle(),
    (async () => {
      try {
        await scanAndQueue(user.id);
      } catch {
        /* non-fatal — see above */
      }
      return supabase
        .from("auto_apply_queue")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("status", "pending");
    })(),
  ]);
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

      <AutoApplyToggle
        enabled={!!autoApplySettings?.enabled}
        pendingCount={pendingQueue.count ?? 0}
      />

      <FilterBar tab={tab} workType={workType} seniority={seniority} />

      {baseResumeError && (
        <p className="border-[1.5px] border-rust bg-rust-soft px-4 py-3 text-[13.5px] text-rust">
          Couldn&apos;t load your resume, so match scores below aren&apos;t
          reliable right now. Try reloading — if this keeps happening,{" "}
          <a href="/resume-builder" className="underline">
            check your Resume Builder
          </a>
          .
        </p>
      )}
      {!baseResumeError && !hasBaseResume && (
        <p className="border-[1.5px] border-line bg-card px-4 py-3 text-[13.5px] text-ink-soft">
          You don&apos;t have a resume yet, so match scores below are just a
          neutral placeholder.{" "}
          <a href="/resume-builder" className="underline">
            Add one in the Resume Builder
          </a>{" "}
          to get real ones.
        </p>
      )}

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

      {/*
        Same nullable-first_name trap as the onboarding headline: this
        rendered "— profile: ." for any user without a name. The whole
        clause is only meaningful when there IS a name, so it's dropped
        rather than left dangling.
      */}
      <p className="text-[12px] italic text-ink-soft">
        Match scores are calculated against your saved resume
        {profile.first_name?.trim() ? ` — profile: ${profile.first_name.trim()}` : ""}.
      </p>
    </div>
  );
}
