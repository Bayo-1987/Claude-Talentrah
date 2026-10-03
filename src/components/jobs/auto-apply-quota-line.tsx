import { AUTO_APPLY_DAILY_SUBMIT_CAP, AUTO_APPLY_FREE_PER_WEEK } from "@/lib/auto-apply/config";
import { CREDIT_COSTS } from "@/lib/credits/costs";

/**
 * "2 of 5 submissions left today · 1 of 5 free this week": the /auto-apply review queue's quota line. The two caps are the enforced
 * constants (rolling 24 hours, rolling 7 days), never typed here; the remaining counts come from the queue's own quota read.
 */
export function AutoApplyQuotaLine({
  quota,
}: {
  quota: { dailyRemaining: number; freeRemaining: number; nextSubmissionCostsCredits: boolean; nextSubmissionCovered: boolean };
}) {
  return (
    <p className="font-body text-[13px] text-ink-soft">
      <span className="font-semibold text-ink">{quota.dailyRemaining}</span> of {AUTO_APPLY_DAILY_SUBMIT_CAP} submissions left today ·{" "}
      <span className="font-semibold text-ink">{quota.freeRemaining}</span> of {AUTO_APPLY_FREE_PER_WEEK} free this week
      {quota.nextSubmissionCostsCredits
        ? quota.nextSubmissionCovered
          ? " · next one is included with your Pass"
          : ` · next one costs ${CREDIT_COSTS.autoApplySubmission} credits`
        : ""}
    </p>
  );
}
