import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireEmployer } from "@/lib/employer/membership";
import { Card, EyebrowLabel, MatchTierBadge } from "@/components/ui";
import { ApplicantStatusSelect } from "@/components/employer/applicant-status-select";
import { MatchBreakdown } from "@/components/jobs/match-breakdown";
import { formatTrackerDate } from "@/lib/tracker/format-date";
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
export default async function JobApplicantsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
  const [{ data: job }, { data: applicants, error }] = await Promise.all([
    supabase
      .from("job_postings")
      .select("id, title")
      .eq("id", id)
      .eq("organization_id", organization.id)
      .maybeSingle(),
    supabase.rpc("employer_job_applicants", { p_job_posting_id: id }),
  ]);

  if (!job) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/employer/jobs"
          className="font-body text-[13px] font-semibold text-ink-soft no-underline hover:text-coral"
        >
          ← Jobs Posted
        </Link>
        <div className="mt-4">
          <EyebrowLabel>Applicants</EyebrowLabel>
          <h1 className="mt-2 font-display text-[30px] leading-[1.15] font-medium text-ink">{job.title}</h1>
        </div>
      </div>

      {error && (
        <p className="border-[1.5px] border-coral bg-coral-soft px-4 py-3 text-[13.5px] text-coral">
          Couldn&apos;t load applicants right now. The job posting itself is fine — try reloading this page.
        </p>
      )}

      {(applicants ?? []).length === 0 ? (
        <Card className="p-8 text-center">
          <p className="font-display text-[18px] font-medium text-ink">No applicants yet.</p>
          <p className="mx-auto mt-2 max-w-[46ch] font-body text-[14px] text-ink-soft">
            Anyone who applies through Talentrah will show up here, with their resume one click away.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col divide-y divide-line border-y border-line">
          {(applicants ?? []).map((applicant) => {
            /*
             * send-158: assistive ranking, not a filter or a replacement for
             * ApplicantStatusSelect below — the sort itself already happened
             * server-side (employer_job_applicants' own ORDER BY, 0154), this
             * just renders what's already in the row. Null whenever
             * computeAndStoreApplicationMatchScore hasn't run for this
             * (user, job) pair yet — an application that predates this
             * feature, or one whose resume lookup failed at apply time —
             * rendered as "not yet scored" rather than a fabricated number.
             */
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

            return (
              <div key={applicant.application_id} className="flex flex-col gap-3 py-4">
                <div className="flex flex-col gap-3 min-[640px]:flex-row min-[640px]:items-center min-[640px]:justify-between">
                  <div className="min-w-0">
                    <p className="font-body text-[14.5px] font-semibold text-ink">
                      {[applicant.first_name, applicant.last_name].filter(Boolean).join(" ") || "Applicant"}
                    </p>
                    <p className="mt-0.5 font-body text-[12.5px] text-ink-soft">
                      Applied {applicant.applied_at ? formatTrackerDate(applicant.applied_at) : "—"}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-4">
                    {applicant.match_score !== null ? (
                      <MatchTierBadge score={applicant.match_score} explanation={explanation ?? undefined} />
                    ) : (
                      <span className="font-body text-[11px] font-bold tracking-[0.14em] text-ink-soft uppercase">
                        Not yet scored
                      </span>
                    )}
                    {applicant.resume_id && (
                      <Link
                        href={`/employer/jobs/${job.id}/applicants/${applicant.application_id}/resume`}
                        className="font-body text-[13px] font-semibold text-ink underline underline-offset-2 hover:text-coral"
                      >
                        View resume
                      </Link>
                    )}
                    <ApplicantStatusSelect
                      applicationId={applicant.application_id}
                      initialStatus={applicant.status}
                    />
                  </div>
                </div>
                {explanation && <MatchBreakdown explanation={explanation} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
