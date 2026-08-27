"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { reportJobPostingAction } from "@/lib/reports/actions";
import { initialReportActionState } from "@/lib/reports/state";
import { REPORT_REASONS } from "@/lib/reports/schemas";

/**
 * "Report" on a job card — the seeker-side input to 0056's removal power.
 *
 * The open/close behaviour is FarahJobMenu's, on purpose: same anchored panel,
 * same outside-click and Escape handling, same bordered box. Two menus on one
 * card that dismissed differently would be a small, constant irritation, and
 * this one sits in the same scrolling list where a menu that traps the page is
 * worse than no menu at all.
 *
 * WHAT IS DELIBERATELY NOT HERE: any indication of whether you have already
 * reported this posting. 0057 revokes SELECT on the table, so the card
 * genuinely cannot know — and the alternative, granting SELECT so a button can
 * render differently, would trade the privacy of an accusation for a piece of
 * UI state. The duplicate is caught by the unique constraint on submit and
 * answered plainly instead.
 */
export interface ReportJobMenuProps {
  jobId: string;
  /** Shown in the panel so the report is unambiguous when several cards are open. */
  jobTitle: string;
}

export function ReportJobMenu({ jobId, jobTitle }: ReportJobMenuProps) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    reportJobPostingAction,
    initialReportActionState,
  );
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const settled = state.status === "success" || state.status === "duplicate";

  return (
    <div ref={wrapRef} className="relative inline-flex items-center">
      {/*
        min-h-10 AND min-w-10. Height alone is what shipped a 39.1px-wide
        target past review in #69 — CLAUDE.md's rule names both dimensions and
        "Report" is a short word. Measured in a browser, not inferred.
      */}
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-10 min-w-10 items-center justify-center gap-[5px] px-1 text-[13px] font-semibold text-ink-soft no-underline hover:text-rust"
      >
        Report
      </button>

      {open && (
        <div
          className="absolute right-0 bottom-[calc(100%+8px)] z-[5] w-[280px] border-[1.5px] border-ink bg-card px-4 pt-3.5 pb-4"
          role="dialog"
          aria-label={`Report ${jobTitle}`}
        >
          {settled ? (
            <p className="text-[12.5px] leading-[1.5] text-ink-soft">
              {state.status === "success"
                ? "Thanks — that's with our team. We review reports by hand; nothing is taken down automatically."
                : "You've already reported this one. One report per person is all we need."}
            </p>
          ) : (
            <form action={formAction} className="flex flex-col gap-2.5">
              <span className="block text-[10.5px] font-bold tracking-[0.1em] text-rust uppercase">
                Report this posting
              </span>

              {state.error && (
                <p className="text-[12.5px] text-rust">{state.error}</p>
              )}

              <input type="hidden" name="jobId" value={jobId} />

              <fieldset className="flex flex-col gap-0">
                <legend className="sr-only">Reason</legend>
                {REPORT_REASONS.map((r, i) => (
                  <label
                    key={r.value}
                    className="flex min-h-10 cursor-pointer items-center gap-2 text-[13px] text-ink hover:text-rust"
                  >
                    <input
                      type="radio"
                      name="reason"
                      value={r.value}
                      defaultChecked={i === 0}
                      className="accent-rust"
                    />
                    {r.label}
                  </label>
                ))}
              </fieldset>

              <label className="sr-only" htmlFor={`details-${jobId}`}>
                Anything else we should know
              </label>
              <textarea
                id={`details-${jobId}`}
                name="details"
                rows={3}
                placeholder="Anything else? (optional)"
                className="border border-line bg-paper px-2.5 py-2 font-body text-[12.5px] text-ink outline-none placeholder:font-display placeholder:italic placeholder:text-ink-soft focus:border-rust"
              />

              <button
                type="submit"
                disabled={pending}
                className="inline-flex min-h-10 min-w-10 items-center justify-center border-none bg-ink px-3.5 font-body text-[12.5px] font-semibold text-paper hover:bg-rust disabled:opacity-60"
              >
                {pending ? "Sending…" : "Send report"}
              </button>

              {/*
                Said here rather than discovered later. A reporting form that
                implies instant takedown invites use as a weapon against a
                competitor; 0056 keeps removal a human decision for that exact
                reason.
              */}
              <p className="font-display text-[11.5px] leading-[1.4] italic text-ink-soft">
                Reviewed by a person. Nothing comes down automatically.
              </p>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
