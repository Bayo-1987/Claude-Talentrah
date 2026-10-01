"use client";

import { useState } from "react";
import { waitForFontsSettled } from "@/lib/resume-builder/wait-for-fonts";
import { printWithTitle, resumePrintTitle } from "@/lib/resume-builder/print-title";

/**
 * Print-to-PDF for the employer's own applicant-resume view (0125).
 *
 * Deliberately NOT resume-builder's own `PrintButton` — that component owns
 * example-content guarding and resume-builder completion tracking, both of
 * which are the SEEKER's own editor concerns and meaningless (worse, wrong)
 * on a page where the viewer is an employer reading someone else's already-
 * finished resume. What the two DO share is the one thing that is about the
 * browser rather than the flow: `window.print()` should not fire while fonts
 * are still loading. Every family here is `font-display: swap`, so a click on
 * a first visit or a slow connection used to print while the page was still on
 * fallback fonts (see wait-for-fonts.ts, and PrintButton's own header for
 * what is and isn't proven — the print firing early is verified; a loss of
 * content from it is not). An employer printing a candidate's resume is
 * exactly as exposed as the candidate is, so this waits too — bounded, with
 * the same "Preparing PDF…" feedback.
 *
 * It shares the other browser-level detail too: the saved file is named after
 * `document.title`, so the print runs under `<First>-<Last>-Resume`
 * (print-title.ts) — the applicant's name, not "Applicant resume — Talentrah" —
 * and the button carries the same "Save as PDF" wording and help line as the
 * seeker's.
 */
export function EmployerPrintButton({ applicantName }: { applicantName?: string }) {
  const [preparing, setPreparing] = useState(false);

  async function handleClick() {
    if (preparing) return;
    setPreparing(true);
    try {
      await waitForFontsSettled();
    } finally {
      setPreparing(false);
    }
    printWithTitle(resumePrintTitle(applicantName));
  }

  return (
    <div className="flex items-center gap-3">
      <p className="max-w-[260px] text-right text-[12.5px] text-ink-soft">
        {"In the print window, choose 'Save as PDF'."}
      </p>
      <button
        type="button"
        onClick={handleClick}
        disabled={preparing}
        aria-busy={preparing}
        className="flex min-h-10 items-center border-[1.5px] border-ink bg-card px-4 font-body text-[13px] font-semibold text-ink hover:border-rust hover:text-rust disabled:opacity-50"
      >
        {preparing ? "Preparing PDF…" : "Save as PDF"}
      </button>
      <span role="status" className="sr-only">
        {preparing ? "Preparing PDF" : ""}
      </span>
    </div>
  );
}
