import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireEmployer } from "@/lib/employer/membership";
import { BorderedCard, EyebrowLabel } from "@/components/ui";
import { ApplicantFilterBar } from "@/components/employer/applicant-filter-bar";
import { ApplicantList, type ApplicantRow } from "@/components/employer/applicant-list";
import {
  applicantMatchesFilter,
  effectiveTierFor,
  parseApplicantFilterParams,
} from "@/lib/employer/applicant-filters";
import type { MatchExplanation } from "@/lib/matching/score";

export const metadata = { title: "Applicants — Talentrah" };

/**
 * The real employer-applicant view (0125) — a structured listing, not just
 * an aggregate count (org_application_counts, 0029). Per-job scope for v1:
 * `/employer/jobs` already renders one row per posting, so this is the
 * natural next screen from there rather than an org-wide roster.
 *
 * Double-checked the same way `[id]/edit/page.tsx` scopes its own job
 * lookup: `.eq("id", id).eq("organization_id", organization.id)`. RLS would
 * already stop this from reading another org's posting (job_postings SELECT
 * is public, so RLS alone doesn't help here — this is a manual out-of-scope
 * guard, not a leak-prevention one), but rendering a 404 for a job that
 * isn't the caller's own is the right response regardless of who could
 * technically read the row.
 *
 * The applicant rows themselves come from `employer_job_applicants` (0125),
 * a SECURITY DEFINER function that derives which org owns the posting and
 * checks the CALLER's membership in it — a second, independent gate from
 * the one above, not a duplicate of it.
 */
export default async function JobApplicantsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tier?: string; unscored?: string; screening?: string }>;
}) {
  const { id } = await params;
  const filterState = parseApplicantFilterParams(await searchParams);
  const { organization } = await requireEmployer();
  const supabase = await createClient();

  /*
   * Run together rather than one after the other: `employer_job_applicants`
   * takes only the raw route param `id` and re-derives ownership itself (see
   * this file's own header — a SECURITY DEFINER function with its own
   * independent membership check), so it needs nothing from the `job`
   * lookup above it. The cost of this is firing the RPC once, harmlessly,
   * for a mistyped/foreign job id that will 404 anyway — the RPC's own gate
   * means that case returns nothing regardless.
   */
  const [{ data: job }, { data: applicants, error }, { count: screeningQuestionCount }, { count: assessmentCount }] =
    await Promise.all([
      supabase
        .from("job_postings")
        .select("id, title")
        .eq("id", id)
        .eq("organization_id", organization.id)
        .maybeSingle(),
      supabase.rpc("employer_job_applicants", { p_job_posting_id: id }),
      // "View answers" (send-344) and the screening filter chips (send-326's
      // own screening dimension) both only make sense to show at all when the
      // posting actually has screening questions — a plain count, not a full
      // fetch, since only the boolean matters here.
      supabase
        .from("job_posting_screening_questions")
        .select("id", { count: "exact", head: true })
        .eq("job_posting_id", id),
      // send-346 v2 — same "plain count, only the boolean matters" shape,
      // independent of screening questions: a posting can have one without
      // the other, or both.
      supabase
        .from("job_posting_assessments")
        .select("id", { count: "exact", head: true })
        .eq("job_posting_id", id),
    ]);

  if (!job) notFound();
  const hasScreeningQuestions = (screeningQuestionCount ?? 0) > 0;
  const hasAssessment = (assessmentCount ?? 0) > 0;

  /*
   * send-158's explanation derivation, unchanged — still the assistive
   * ranking display, not a filter. `effectiveTierFor` (applicant-filters.ts)
   * reuses this same explanation to compute the tier the badge will
   * actually show, so the tier chips below can never disagree with what a
   * recruiter sees on the row itself.
   */
  const rows: ApplicantRow[] = (applicants ?? []).map((applicant) => {
    const explanation: MatchExplanation | null =
      applicant.match_score !== null &&
      applicant.matched_skills !== null &&
      applicant.missing_skills !== null &&
      applicant.seniority_alignment !== null
        ? {
            matchedSkills: applicant.matched_skills as string[],
            missingSkills: applicant.missing_skills as string[],
            seniorityAlignment: applicant.seniority_alignment as MatchExplanation["seniorityAlignment"],
          }
        : null;
    return {
      application_id: applicant.application_id,
      first_name: applicant.first_name,
      last_name: applicant.last_name,
      applied_at: applicant.applied_at,
      match_score: applicant.match_score,
      resume_id: applicant.resume_id,
      status: applicant.status,
      explanation,
      // send-328 — never gated on talent_directory_opt_in, see 0170's own
      // header for the consent reasoning.
      talentVerificationStatus: applicant.talent_verification_status,
      talentVerificationScore: applicant.talent_verification_score,
      // send-327 — null means no screening questions, or answers incomplete.
      screeningPassed: applicant.screening_passed,
    };
  });

  // send-326 — a page-level filter over the array the RPC already returned;
  // no new query, no change to employer_job_applicants itself. The
  // screening dimension follows the identical pattern, added later.
  const filteredRows = rows.filter((row) =>
    applicantMatchesFilter(
      row.match_score,
      effectiveTierFor(row.match_score, row.explanation),
      filterState,
      row.screeningPassed,
    ),
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/employer/jobs"
          className="font-body text-[13px] font-semibold text-ink-soft no-underline hover:text-rust"
        >
          ← Jobs Posted
        </Link>
        <div className="mt-4">
          <EyebrowLabel>Applicants</EyebrowLabel>
          <h1 className="mt-2 font-display text-[30px] leading-[1.15] font-medium text-ink">{job.title}</h1>
        </div>
      </div>

      {error && (
        <p className="border-[1.5px] border-rust bg-rust-soft px-4 py-3 text-[13.5px] text-rust">
          Couldn&apos;t load applicants right now. The job posting itself is fine — try reloading this page.
        </p>
      )}

      {rows.length === 0 ? (
        <BorderedCard className="p-8 text-center">
          <p className="font-display text-[18px] font-medium text-ink">No applicants yet.</p>
          <p className="mx-auto mt-2 max-w-[46ch] font-body text-[14px] text-ink-soft">
            Anyone who applies through Talentrah will show up here, with their resume one click away.
          </p>
        </BorderedCard>
      ) : (
        <>
          <ApplicantFilterBar
            jobId={job.id}
            tiers={filterState.tiers}
            hideUnscored={filterState.hideUnscored}
            screening={filterState.screening}
            hasScreeningQuestions={hasScreeningQuestions}
          />
          {filteredRows.length === 0 ? (
            <BorderedCard className="p-8 text-center">
              <p className="font-display text-[18px] font-medium text-ink">No applicants match these filters.</p>
              <p className="mx-auto mt-2 max-w-[46ch] font-body text-[14px] text-ink-soft">
                Clear a filter above to see the rest of your applicants.
              </p>
            </BorderedCard>
          ) : (
            <ApplicantList
              jobId={job.id}
              applicants={filteredRows}
              hasScreeningQuestions={hasScreeningQuestions}
              hasAssessment={hasAssessment}
            />
          )}
        </>
      )}
    </div>
  );
}
