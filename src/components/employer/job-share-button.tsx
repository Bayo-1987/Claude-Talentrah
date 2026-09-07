"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { buttonClasses } from "@/components/ui";
import { ShareButtons } from "@/components/referrals/share-buttons";
import type { JobShareVisibility } from "@/lib/employer/job-visibility";

/**
 * The employer's own share affordance for a posting they made — distinct
 * from ShareJobButton (src/components/jobs/share-job-button.tsx), which is
 * the candidate-facing one on a feed card. Same underlying ShareButtons
 * plumbing, reused rather than reimplemented, but different copy (an
 * employer isn't recommending the role to a friend, they're distributing
 * their own listing) and — the part ShareJobButton has no reason to need —
 * gated on whether the link actually goes anywhere.
 *
 * WHEN `visibility` IS "unreachable" this renders NO share action and NO
 * copy-link, on any path — not a disabled button, not a button that copies a
 * link and lets the click-through 404 speak for itself. A dead link handed
 * to a candidate is worse than no link: it reads as the product being
 * broken rather than as a step still pending. Instead it renders a short,
 * honest line pointing at what unlocks it.
 */
export function EmployerJobShareButton({
  jobId,
  jobTitle,
  origin,
  visibility,
}: {
  jobId: string;
  jobTitle: string;
  /** Resolved server-side — see ShareJobButton's own comment on why. */
  origin: string;
  visibility: JobShareVisibility;
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

  if (visibility === "unreachable") {
    return (
      <Link
        href="/employer/profile"
        className="font-body text-[13.5px] font-semibold text-ink-soft underline underline-offset-2 hover:text-rust"
        title="Sharing unlocks once your company is verified"
      >
        Unlock sharing
      </Link>
    );
  }

  const url = `${origin}/jobs/${jobId}`;

  return (
    <div ref={wrapRef} className="relative inline-flex items-center">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={buttonClasses("text", "sm")}
      >
        Share
      </button>

      {open && (
        <div
          className="absolute right-0 bottom-[calc(100%+8px)] z-[15] w-[300px] border-[1.5px] border-ink bg-card px-4 pt-3.5 pb-4"
          role="dialog"
          aria-label={`Share ${jobTitle}`}
        >
          <span className="mb-[10px] block text-[10.5px] font-bold tracking-[0.1em] text-rust uppercase">
            {visibility === "unlisted" ? "Share this private link" : "Share this listing"}
          </span>
          {/*
            NAMED, not implied. An unlisted job is reachable by anyone holding
            the link and appears in no feed, search result or sitemap — an
            employer who thinks they are sharing a public listing would make a
            different decision about who to send it to than one who knows it is
            a link that works for whoever receives it.
          */}
          {visibility === "unlisted" && (
            <p className="mb-2.5 font-body text-[12.5px] text-ink-soft">
              Not listed on the job board yet — this link works for anyone you send it to.
            </p>
          )}
          <ShareButtons
            url={url}
            linkedIn
            subject={`We're hiring: ${jobTitle}`}
            message={`We're hiring for ${jobTitle} — take a look:`}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Same popover, rendered already-open and inline rather than behind a
 * trigger — for the post-success surface, where the whole point is that the
 * link is right there without another click.
 */
export function EmployerJobShareInline({
  jobId,
  jobTitle,
  origin,
  visibility,
}: {
  jobId: string;
  jobTitle: string;
  origin: string;
  visibility: JobShareVisibility;
}) {
  if (visibility === "unreachable") {
    return (
      <p className="font-body text-[13.5px] text-ink-soft">
        This job isn&apos;t shareable yet, so there&apos;s no link —{" "}
        <Link href="/employer/profile" className="font-semibold text-rust underline underline-offset-2">
          verify your company
        </Link>{" "}
        to unlock it.
      </p>
    );
  }

  const url = `${origin}/jobs/${jobId}`;

  return (
    <div>
      {visibility === "unlisted" && (
        <p className="mb-2 font-body text-[13.5px] text-ink">
          <span className="font-semibold">Private link.</span> This job isn&apos;t on the job
          board, in search or in the sitemap — but anyone with this link can open it.
        </p>
      )}
      <p className="mb-2 font-body text-[13.5px] text-ink-soft break-all">{url}</p>
      <ShareButtons
        url={url}
        linkedIn
        subject={`We're hiring: ${jobTitle}`}
        message={`We're hiring for ${jobTitle} — take a look:`}
      />
    </div>
  );
}
