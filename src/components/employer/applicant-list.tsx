"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MatchTierBadge } from "@/components/ui";
import { ApplicantStatusSelect } from "./applicant-status-select";
import { MatchBreakdown } from "@/components/jobs/match-breakdown";
import { formatTrackerDate } from "@/lib/tracker/format-date";
import { setApplicantStatusAction } from "@/lib/employer/actions";
import type { MatchExplanation } from "@/lib/matching/score";
import type { Enums } from "@/lib/supabase/types";

type ApplicantReviewStatus = Enums<"applicant_review_status">;

export interface ApplicantRow {
  application_id: string;
  first_name: string | null;
  last_name: string | null;
  applied_at: string | null;
  match_score: number | null;
  resume_id: string | null;
  status: ApplicantReviewStatus;
  explanation: MatchExplanation | null;
  /**
   * send-328 — deliberately NOT gated on talent_directory_opt_in (see
   * migration 0170's own header for the consent reasoning): a verified
   * skill credential is closer to a resume fact than to directory
   * discoverability, and the candidate has already chosen to be seen by
   * THIS employer by applying. Render the badge for 'verified' only, never
   * a partial-credit display for 'pending'/'rejected'/'unverified'.
   */
  talentVerificationStatus: string;
  talentVerificationScore: number | null;
}

const BULK_ACTIONS: { status: ApplicantReviewStatus; label: string }[] = [
  { status: "shortlisted", label: "Shortlist selected" },
  { status: "not_a_fit", label: "Not a fit selected" },
];

/**
 * send-326 — checkboxes + a bulk-action bar over the SAME per-applicant
 * write `ApplicantStatusSelect` already uses (`setApplicantStatusAction`),
 * one call per selected id via `Promise.all`. No new backend: bulk is a
 * client convenience over an action that already exists.
 *
 * WHY THIS ISN'T "OPTIMISTIC" THE WAY THE SINGLE-ROW SELECT IS. That control
 * owns one row's status as its own local state, so it can flip immediately
 * and revert on failure with no coordination problem. A bulk action touches
 * N of those controls at once — faking N optimistic updates here and then
 * reconciling a PARTIAL failure (3 of 10 rejected) would mean either
 * duplicating each row's status at this level (two sources of truth for the
 * same field) or reaching into sibling components' state, both worse than
 * the alternative: disable the bar while the writes are in flight, surface
 * a real count if any failed, and `router.refresh()` so every row — bulk-
 * touched or not — ends up showing its actual, confirmed status. Slower to
 * feel than a single-row flip, but it never claims a status changed before
 * it genuinely did.
 */
export function ApplicantList({ jobId, applicants }: { jobId: string; applicants: ApplicantRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const allSelected = applicants.length > 0 && selected.size === applicants.length;

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(applicants.map((a) => a.application_id)));
  }

  function runBulk(status: ApplicantReviewStatus) {
    const ids = [...selected];
    setError(null);
    startTransition(async () => {
      const results = await Promise.all(ids.map((id) => setApplicantStatusAction(id, status)));
      const failed = results.filter((r) => "error" in r).length;
      if (failed > 0) {
        setError(
          failed === ids.length
            ? "Couldn't update any of the selected applicants — try again."
            : `${failed} of ${ids.length} couldn't be updated — try again.`,
        );
      }
      setSelected(new Set());
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {applicants.length > 0 && (
        <label className="flex min-h-10 w-fit cursor-pointer items-center gap-2 font-body text-[12.5px] font-semibold text-ink-soft">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            className="h-4 w-4 border-[1.5px] border-ink"
          />
          Select all
        </label>
      )}

      {selected.size > 0 && (
        <div
          data-testid="bulk-action-bar"
          className="flex flex-wrap items-center gap-3 border-[1.5px] border-ink bg-card px-4 py-3"
        >
          <span className="font-body text-[13px] font-semibold text-ink">{selected.size} selected</span>
          {BULK_ACTIONS.map(({ status, label }) => (
            <button
              key={status}
              type="button"
              disabled={pending}
              onClick={() => runBulk(status)}
              className="min-h-10 border-[1.5px] border-ink px-3.5 font-body text-[13px] font-semibold text-ink no-underline hover:border-rust hover:text-rust disabled:opacity-60"
            >
              {label}
            </button>
          ))}
          {pending && <span className="font-body text-[12.5px] text-ink-soft">Updating…</span>}
        </div>
      )}
      {error && <p className="font-body text-[12.5px] text-rust">{error}</p>}

      <div className="flex flex-col divide-y divide-line border-y border-line">
        {applicants.map((applicant) => (
          <div key={applicant.application_id} className="flex flex-col gap-3 py-4">
            <div className="flex flex-col gap-3 min-[640px]:flex-row min-[640px]:items-center min-[640px]:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <input
                  type="checkbox"
                  checked={selected.has(applicant.application_id)}
                  onChange={() => toggleOne(applicant.application_id)}
                  aria-label={`Select ${
                    [applicant.first_name, applicant.last_name].filter(Boolean).join(" ") || "applicant"
                  }`}
                  className="h-4 w-4 flex-shrink-0 border-[1.5px] border-ink"
                />
                <div className="min-w-0">
                  <p className="font-body text-[14.5px] font-semibold text-ink">
                    {[applicant.first_name, applicant.last_name].filter(Boolean).join(" ") || "Applicant"}
                  </p>
                  <p className="mt-0.5 font-body text-[12.5px] text-ink-soft">
                    Applied {applicant.applied_at ? formatTrackerDate(applicant.applied_at) : "—"}
                  </p>
                  {applicant.talentVerificationStatus === "verified" && (
                    <p className="mt-0.5 text-[12.5px] font-semibold text-green">
                      Verified — {applicant.talentVerificationScore}/100
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-4">
                {applicant.match_score !== null ? (
                  <MatchTierBadge
                    score={applicant.match_score}
                    explanation={applicant.explanation ?? undefined}
                  />
                ) : (
                  <span className="font-body text-[11px] font-bold tracking-[0.14em] text-ink-soft uppercase">
                    Not yet scored
                  </span>
                )}
                {applicant.resume_id && (
                  <Link
                    href={`/employer/jobs/${jobId}/applicants/${applicant.application_id}/resume`}
                    className="font-body text-[13px] font-semibold text-ink underline underline-offset-2 hover:text-rust"
                  >
                    View resume
                  </Link>
                )}
                {/*
                  Keyed by `status`: this control owns its OWN local state
                  once mounted (see its header comment) and would not
                  otherwise notice a status this bulk bar just changed —
                  `router.refresh()` above sends a fresh `status`, and the
                  key change is what forces a genuine remount to pick it up.
                */}
                <ApplicantStatusSelect
                  key={applicant.status}
                  applicationId={applicant.application_id}
                  initialStatus={applicant.status}
                />
              </div>
            </div>
            {applicant.explanation && <MatchBreakdown explanation={applicant.explanation} />}
          </div>
        ))}
      </div>
    </div>
  );
}
