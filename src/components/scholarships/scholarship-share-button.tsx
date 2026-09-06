"use client";

import { useEffect, useRef, useState } from "react";
import { IconButton } from "@/components/ui";
import { ShareButtons, type ShareChannel } from "@/components/referrals/share-buttons";
import { logShareAction } from "@/lib/referrals/actions";

/**
 * Sharing one scholarship — same shape as `ShareJobButton`, same interaction
 * and z-index behavior, deliberately not a second pattern.
 *
 * TWO REAL DIFFERENCES FROM THE JOB VERSION, both on purpose:
 *
 * 1. `referralCode` is appended as `?ref=` when present. A job share carries
 *    none at all (see that file's own comment — a job share was never a
 *    referral-funnel step). A scholarship share IS one, because scholarships
 *    are the growth wedge this whole feature exists for: get to fifty
 *    verified listings, then post them into WhatsApp/Telegram groups. The
 *    link still works with no code at all — `referralCode` is optional, and
 *    a signed-out reader who somehow reached this button (they can't today;
 *    the button only renders on the authenticated list) would still get a
 *    complete, working share.
 * 2. It DOES log, through the same `logShareAction`/`referral_shares` path
 *    /refer already uses, but passes `"scholarship"` as the surface
 *    (migration 0099) rather than letting it default to `"refer"` — so a
 *    scholarship share is counted, and counted as itself, not silently
 *    folded into /refer's own funnel numbers.
 */
export function ScholarshipShareButton({
  scholarshipId,
  programName,
  provider,
  origin,
  referralCode,
}: {
  scholarshipId: string;
  programName: string;
  provider: string;
  /** Absolute base for the shared URL, resolved once by the page — see ShareJobButton's own comment on why. */
  origin: string;
  /** The sharer's own code, when they have one. Appended as `?ref=`; omitted (not just empty) when absent. */
  referralCode?: string | null;
}) {
  const [open, setOpen] = useState(false);
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

  const base = `${origin}/scholarships/${scholarshipId}`;
  const url = referralCode ? `${base}?ref=${referralCode}` : base;

  function handleShare(channel: ShareChannel) {
    logShareAction(channel, "scholarship");
  }

  return (
    <div ref={wrapRef} className="relative inline-flex items-center">
      <IconButton
        aria-label={open ? "Close share options" : "Share this scholarship"}
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
          aria-label={`Share ${programName}`}
        >
          <span className="mb-[10px] block text-[10.5px] font-bold tracking-[0.1em] text-rust uppercase">
            Share this scholarship
          </span>
          <ShareButtons
            url={url}
            compact
            subject={`${programName} — ${provider}`}
            message={`${programName} (${provider}) — found this on Talentrah, thought of you:`}
            onShare={handleShare}
          />
        </div>
      )}
    </div>
  );
}
