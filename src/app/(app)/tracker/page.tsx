import Link from "next/link";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { EyebrowLabel } from "@/components/ui";
import { StageFilterBar } from "@/components/tracker/stage-filter-bar";
import { ManualEntryForm } from "@/components/tracker/manual-entry-form";
import { TrackerCard, type TrackerEntry } from "@/components/tracker/tracker-card";
import { HiredReferralBanner } from "@/components/tracker/hired-referral-banner";
import { Constants, type Enums } from "@/lib/supabase/types";

export const metadata = { title: "Job Tracker — Talentrah" };

type SearchParams = Promise<{ stage?: string; sort?: string; justHired?: string }>;
type ApplicationStage = Enums<"application_stage">;

const VALID_STAGES: readonly string[] = Constants.public.Enums.application_stage;

export default async function TrackerPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, profile } = await requireUser();
  const params = await searchParams;
  const stage = VALID_STAGES.includes(params.stage ?? "")
    ? (params.stage as ApplicationStage)
    : "all";
  const sort = params.sort === "oldest" ? "oldest" : "newest";

  const supabase = await createClient();

  const [{ data: rows }, { count: totalCount }] = await Promise.all([
    (() => {
      let query = supabase
        .from("applications")
        .select(
          "id, stage, applied_at, notes, created_at, job_posting_id, manual_job_snapshot, resume_id, cover_letter_id, job_postings(company_name, title, location, external_url), application_stage_events(stage, changed_at)",
        )
        .eq("user_id", user.id);
      if (stage !== "all") query = query.eq("stage", stage);
      return query;
    })(),
    supabase
      .from("applications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id),
  ]);

  const entries: TrackerEntry[] = (rows ?? []).map((row) => {
    const snapshot = row.manual_job_snapshot as {
      companyName: string;
      title: string;
      url?: string;
      location?: string;
    } | null;
    const job = row.job_postings;

    return {
      id: row.id,
      stage: row.stage,
      appliedAt: row.applied_at,
      notes: row.notes,
      companyName: job?.company_name ?? snapshot?.companyName ?? "Unknown company",
      title: job?.title ?? snapshot?.title ?? "Untitled role",
      location: job?.location ?? snapshot?.location ?? null,
      url: job?.external_url ?? snapshot?.url ?? null,
      isManual: !row.job_posting_id,
      resumeId: row.resume_id,
      coverLetterId: row.cover_letter_id,
      history: (row.application_stage_events ?? [])
        .map((h) => ({ stage: h.stage, changedAt: h.changed_at }))
        .sort((a, b) => new Date(a.changedAt).getTime() - new Date(b.changedAt).getTime()),
    };
  });

  entries.sort((a, b) => {
    const aTime = new Date(a.appliedAt ?? a.history[0]?.changedAt ?? 0).getTime();
    const bTime = new Date(b.appliedAt ?? b.history[0]?.changedAt ?? 0).getTime();
    return sort === "newest" ? bTime - aTime : aTime - bTime;
  });

  const justHiredEntry = params.justHired
    ? entries.find((e) => e.id === params.justHired && e.stage === "hired")
    : undefined;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <EyebrowLabel>Every job, one place</EyebrowLabel>
        <h1 className="mt-1.5 text-[26px]">Job Tracker</h1>
      </div>

      {justHiredEntry && (
        <HiredReferralBanner jobTitle={justHiredEntry.title} referralCode={profile.referral_code} />
      )}

      <ManualEntryForm />

      <StageFilterBar stage={stage} sort={sort} />

      {(totalCount ?? 0) === 0 ? (
        <p className="py-12 text-center text-[14.5px] text-ink-soft">
          Nothing tracked yet — save a job from{" "}
          <Link href="/jobs" className="underline hover:text-rust">
            the feed
          </Link>{" "}
          or add one you applied to elsewhere above.
        </p>
      ) : entries.length === 0 ? (
        <p className="py-12 text-center text-[14.5px] text-ink-soft">
          Nothing in this stage yet.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {entries.map((entry) => (
            <TrackerCard key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
