"use client";

import { useEffect, useRef, useState } from "react";
import { IconButton } from "@/components/ui";
import { ShareButtons } from "@/components/referrals/share-buttons";

/**
 * Sharing one job.
 *
 * The button was a stub — `title="Coming soon"`, `cursor-not-allowed`, no
 * handler — sitting next to two that worked. This wires it to the same
 * `ShareButtons` the referral page uses, in its compact form.
 *
 * NOTHING IS LOGGED. `ShareButtons` used to call `logShareAction` itself,
 * which writes to `referral_shares`; that table is the referral funnel
 * (invited → signed up → activated → reward) and a job share is not a step in
 * it. Counting one there would inflate a metric the referral programme is
 * measured on and corrupt the only record of how referrals actually perform.
 * The component now takes an `onShare` callback and this caller passes none —
 * so not logging is the default rather than a flag someone can forget to set.
 *
 * The link targets /jobs/[id], which is a real page as of #76. Before that
 * this would have shared a 404.
 */
export function ShareJobButton({
  jobId,
  jobTitle,
  companyName,
  origin,
}: {
  jobId: string;
  jobTitle: string;
  companyName: string;
  /**
   * Absolute base for the shared URL, resolved on the server.
   *
   * A relative path is useless in a WhatsApp message, and `window.location`
   * would only be readable after hydration — so the first render would emit a
   * broken link and silently fix it later.
   */
  origin: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Same dismissal contract as the Farah and Report menus on this card:
  // outside click and Escape. Three popovers behaving differently in one
  // footer is a small, constant irritation.
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

  const url = `${origin}/jobs/${jobId}`;

  return (
    <div ref={wrapRef} className="relative inline-flex items-center">
      <IconButton
        aria-label={open ? "Close share options" : "Share this job"}
        aria-expanded={open}
        type="button"
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <circle cx="15" cy="5" r="2.2" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="5" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="15" cy="15" r="2.2" stroke="currentColor" strokeWidth="1.4" />
          <path d="M7 8.8 L13 6.2 M7 11.2 L13 13.8" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </IconButton>

      {open && (
        <div
          className="absolute right-0 bottom-[calc(100%+8px)] z-[15] w-[300px] border-[1.5px] border-ink bg-card px-4 pt-3.5 pb-4"
          role="dialog"
          aria-label={`Share ${jobTitle}`}
        >
          <span className="mb-[10px] block text-[10.5px] font-bold tracking-[0.1em] text-rust uppercase">
            Share this job
          </span>
          <ShareButtons
            url={url}
            compact
            subject={`${jobTitle} at ${companyName}`}
            message={`${jobTitle} at ${companyName} — found this on Talentrah, thought of you:`}
          />
        </div>
      )}
    </div>
  );
}
