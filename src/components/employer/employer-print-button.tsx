"use client";

/**
 * Print-to-PDF for the employer's own applicant-resume view (0125).
 *
 * Deliberately NOT resume-builder's own `PrintButton` — that component owns
 * example-content guarding and resume-builder completion tracking, both of
 * which are the SEEKER's own editor concerns and meaningless (worse, wrong)
 * on a page where the viewer is an employer reading someone else's already-
 * finished resume. `window.print()` itself is the whole reusable mechanism;
 * everything else in that component is specific to the flow this isn't.
 */
export function EmployerPrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="flex min-h-10 items-center border-[1.5px] border-ink bg-card px-4 font-body text-[13px] font-semibold text-ink hover:border-rust hover:text-rust"
    >
      Print / Save as PDF
    </button>
  );
}
