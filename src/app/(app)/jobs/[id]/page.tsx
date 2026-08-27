import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { BorderedCard, Button, EyebrowLabel, MatchTierBadge, buttonClasses } from "@/components/ui";
import { getCompanyInitials } from "@/lib/jobs/company-initials";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { freshnessNote } from "@/lib/jobs/freshness-note";
import { skillsOf } from "@/lib/jobs/skill-facet";
import { computeAndStoreMatchScores } from "@/lib/matching/compute-and-store";
import { EMPTY_RESUME } from "@/lib/resume/types";
import type { StructuredResume } from "@/lib/resume/types";
import {
  toggleSaveAction,
  applyInAppAction,
  markAppliedExternallyAction,
} from "@/lib/applications/actions";

const WORK_TYPE_LABEL: Record<string, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "Onsite",
};

const SENIORITY_LABEL: Record<string, string> = {
  entry: "Entry",
  mid: "Mid-level",
  senior: "Senior",
  lead: "Lead",
  executive: "Executive",
};

const EMPLOYMENT_LABEL: Record<string, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  internship: "Internship",
};

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  // Same client as the page, so a posting the reader cannot see does not leak
  // its title through the tab.
  const { data } = await supabase
    .from("job_postings")
    .select("title, company_name")
    .eq("id", id)
    .maybeSingle();
  return {
    title: data ? `${data.title} — ${data.company_name} — Talentrah` : "Job — Talentrah",
  };
}

/**
 * One posting, in full.
 *
 * There was no route for this at all: the feed truncated every description at
 * 280 characters and the card title was not a link, so the only way to read a
 * job was to leave for the source site — which for an internal posting does
 * not exist.
 *
 * READ THROUGH THE USER'S OWN CLIENT, never the service role. RLS is what
 * decides whether this posting is visible: an unverified company's listing
 * (0027), and a removed one (0056), are both invisible here for the same
 * reason they are invisible in the feed. A detail page that fetched with
 * elevated credentials would be a way around the gate that the feed respects,
 * and `notFound()` is the right answer for both "no such job" and "not yours
 * to see" — distinguishing them would itself leak.
 */
export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user } = await requireUser();
  const supabase = await createClient();

  const [{ data: job }, { data: baseResume, error: baseResumeError }, { data: application }] =
    await Promise.all([
      supabase.from("job_postings").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("resumes")
        .select("structured_content")
        .eq("user_id", user.id)
        .eq("is_base", true)
        .maybeSingle(),
      supabase
        .from("applications")
        .select("stage")
        .eq("user_id", user.id)
        .eq("job_posting_id", id)
        .maybeSingle(),
    ]);

  if (!job) notFound();

  /*
   * Same fallback rule as the feed: an empty resume only when there genuinely
   * is not one. A query ERROR scored against EMPTY_RESUME would look identical
   * to "no resume yet" while actually meaning something is broken — the exact
   * shape of QA audit bug #1.
   */
  const resume =
    (!baseResumeError ? (baseResume?.structured_content as StructuredResume | null) : null) ??
    EMPTY_RESUME;

  // One job through the same function the feed uses, so the number here and
  // the number on the card cannot drift apart.
  const [scored] = await computeAndStoreMatchScores(supabase, user.id, resume, [job]);

  const isExternal = job.source_type === "external";
  const stage = application?.stage ?? null;
  const isSaved = stage === "saved";
  const alreadyApplied =
    stage === "applied" || stage === "interviewing" || stage === "offer" || stage === "hired";

  const freshness = freshnessNote(job);
  // The feed's own parser, not a second reading of structured_jd — it already
  // tolerates a missing key, a non-array, and non-string members.
  const skills = skillsOf(job);

  const meta = [
    job.location,
    job.work_type ? WORK_TYPE_LABEL[job.work_type] : null,
    job.seniority ? SENIORITY_LABEL[job.seniority] : null,
    job.employment_type ? EMPLOYMENT_LABEL[job.employment_type] : null,
    job.years_experience_min ? `${job.years_experience_min}+ years` : null,
  ].filter(Boolean);

  return (
    <div className="flex max-w-[760px] flex-col gap-6">
      <Link
        href="/jobs"
        className="inline-flex min-h-10 min-w-10 items-center self-start text-[13px] font-semibold text-ink-soft no-underline hover:text-rust"
      >
        ← Back to jobs
      </Link>

      <div className="flex items-start gap-4">
        <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center bg-ink font-display text-[19px] font-bold text-paper">
          {getCompanyInitials(job.company_name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <h1 className="text-[28px] leading-[1.2]">{job.title}</h1>
            <MatchTierBadge score={scored.score} className="flex-shrink-0" />
          </div>
          <p className="mt-1 text-[15px] text-ink-soft">{job.company_name}</p>
          {meta.length > 0 && (
            <p className="mt-0.5 text-[13.5px] text-ink-soft">{meta.join(" · ")}</p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1 border-y border-line py-3">
        <span className="text-[12.5px] text-ink-soft">
          {formatRelativeTime(job.posted_at)}
          {isExternal && " · sourced externally"}
        </span>
        {/* Same line, same rule, same module as the card — see 0053-era note. */}
        {freshness && (
          <span className="font-display text-[12px] italic text-ink-soft">{freshness}</span>
        )}
        {job.status !== "open" && (
          <span className="text-[12.5px] font-semibold text-amber">
            This posting is no longer open.
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <form action={toggleSaveAction.bind(null, job.id)}>
          <button type="submit" className={buttonClasses("secondary", "sm")}>
            {isSaved ? "Saved — remove" : "Save"}
          </button>
        </form>

        {alreadyApplied ? (
          <span className="inline-flex min-h-10 items-center text-[13.5px] font-semibold text-green">
            Applied
          </span>
        ) : isExternal ? (
          <>
            <a
              href={job.external_url ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClasses("primary", "sm", "no-underline")}
            >
              Apply on company site
            </a>
            <form action={markAppliedExternallyAction.bind(null, job.id)}>
              <button type="submit" className={buttonClasses("text", "sm")}>
                Mark as applied
              </button>
            </form>
          </>
        ) : (
          <form action={applyInAppAction.bind(null, job.id)}>
            <Button size="sm" type="submit">
              Apply
            </Button>
          </form>
        )}

        <Link href={`/tailor?jobId=${job.id}`} className={buttonClasses("text", "sm", "no-underline")}>
          Tailor my resume for this
        </Link>
      </div>

      {skills.length > 0 && (
        <BorderedCard className="flex flex-col gap-2 p-5">
          <EyebrowLabel size="sm">Skills named in this posting</EyebrowLabel>
          <p className="text-[14px] leading-relaxed text-ink-soft">{skills.join(" · ")}</p>
        </BorderedCard>
      )}

      <div className="flex flex-col gap-3">
        <EyebrowLabel size="sm">Full description</EyebrowLabel>
        {/*
          whitespace-pre-line, and the whole thing. The feed's 280-character
          slice is what this page exists to undo, so re-truncating here would
          leave the product with no way to read a job at all.
        */}
        <div className="text-[15px] leading-relaxed whitespace-pre-line text-ink-soft">
          {job.description}
        </div>
      </div>
    </div>
  );
}
