"use client";

import { useState } from "react";
import { waitForFontsSettled } from "@/lib/resume-builder/wait-for-fonts";

/**
 * Print-to-PDF for the employer's own applicant-resume view (0125).
 *
 * Deliberately NOT resume-builder's own `PrintButton` — that component owns
 * example-content guarding and resume-builder completion tracking, both of
 * which are the SEEKER's own editor concerns and meaningless (worse, wrong)
 * on a page where the viewer is an employer reading someone else's already-
 * finished resume. What the two DO share is the one thing that is about the
 * browser rather than the flow: `window.print()` must not fire while fonts are
 * still loading. Every family here is `font-display: swap`, so a click on a
 * first visit or a slow connection used to hand the print engine a mid-swap
 * layout, and Chromium can lock page breaks in from that layout and drop
 * sections from the exported PDF (see wait-for-fonts.ts, and PrintButton's
 * own header for the full history). An employer printing a candidate's
 * resume is exactly as exposed as the candidate is, so this waits too —
 * bounded, with the same "Preparing PDF…" feedback.
 */
export function EmployerPrintButton() {
  const [preparing, setPreparing] = useState(false);

  async function handleClick() {
    if (preparing) return;
    setPreparing(true);
    try {
      await waitForFontsSettled();
    } finally {
      setPreparing(false);
    }
    window.print();
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={preparing}
        aria-busy={preparing}
        className="flex min-h-10 items-center border-[1.5px] border-ink bg-card px-4 font-body text-[13px] font-semibold text-ink hover:border-rust hover:text-rust disabled:opacity-50"
      >
        {preparing ? "Preparing PDF…" : "Print / Save as PDF"}
      </button>
      <span role="status" className="sr-only">
        {preparing ? "Preparing PDF" : ""}
      </span>
    </>
  );
}
