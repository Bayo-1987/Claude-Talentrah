import { RESUME_REVIEW_MEANING, reviewedBadgeText, type ReviewMethod } from "@/lib/talent-directory/review-badge";
import { howWeReviewHref } from "@/lib/talent-directory/how-we-review-link";

/**
 * The Talent Directory badge, wherever an employer sees it (VERIFY-1 Phase 0a): who reviewed the resume and when, with "What this means" openable from it.
 * A native <details>: it opens by keyboard and for screen readers with no script, and it is closed until asked for. It takes a method and a date, never a
 * score: a score cannot reach an employer's screen through this component.
 */
export function ResumeReviewedBadge({
  method,
  reviewedAt,
  className = "",
  from,
}: {
  method: ReviewMethod;
  reviewedAt?: string | null;
  className?: string;
  /** The page this badge is on, as an allow-listed path (see how-we-review-link.ts), so "How we review" can offer a way back. Never an id. */
  from?: string;
}) {
  return (
    <div className={className}>
      <p data-testid="resume-reviewed-badge" className="text-[12.5px] font-semibold text-ink-soft">
        {reviewedBadgeText(method, reviewedAt)}
      </p>
      <details className="mt-0.5 text-[12.5px] text-ink-soft">
        <summary className="inline-flex min-h-8 cursor-pointer items-center text-rust underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rust">
          What this means
        </summary>
        <p className="mt-1 max-w-[46ch]">
          {RESUME_REVIEW_MEANING}{" "}
          <a href={howWeReviewHref(from)} className="font-semibold text-rust underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-rust">
            How we review
          </a>
        </p>
      </details>
    </div>
  );
}
