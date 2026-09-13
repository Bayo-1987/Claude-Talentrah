"use client";

import { useState, useTransition } from "react";
import { setApplicantStatusAction } from "@/lib/employer/actions";
import type { Enums } from "@/lib/supabase/types";

type ApplicantReviewStatus = Enums<"applicant_review_status">;

const STATUS_LABEL: Record<ApplicantReviewStatus, string> = {
  new: "New",
  reviewing: "Reviewing",
  shortlisted: "Shortlisted",
  interviewing: "Interviewing",
  hired: "Hired",
  not_a_fit: "Not a fit",
};

const STATUS_OPTIONS = Object.keys(STATUS_LABEL) as ApplicantReviewStatus[];

/**
 * The employer's own status control for one applicant (0125) — writes
 * through `setApplicantStatusAction`, which is `employer_applicant_status`'s
 * RLS, not `applications.stage`. Optimistic: the select updates immediately
 * and reverts only if the write actually fails, since a per-row dropdown
 * that waits on a round trip before reflecting the click reads as broken.
 */
export function ApplicantStatusSelect({
  applicationId,
  initialStatus,
}: {
  applicationId: string;
  initialStatus: ApplicantReviewStatus;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as ApplicantReviewStatus;
    const previous = status;
    setStatus(next);
    setError(null);
    startTransition(async () => {
      const result = await setApplicantStatusAction(applicationId, next);
      if ("error" in result) {
        setStatus(previous);
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <select
        value={status}
        onChange={handleChange}
        disabled={pending}
        aria-label="Applicant status"
        className="min-h-10 border-[1.5px] border-ink bg-card px-2.5 font-body text-[13px] text-ink outline-none focus:border-coral disabled:opacity-60"
      >
        {STATUS_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      {error && <p className="max-w-[180px] text-right text-[11.5px] text-coral">{error}</p>}
    </div>
  );
}
