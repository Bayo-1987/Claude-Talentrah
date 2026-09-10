"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { takePendingJobBanner } from "@/lib/employer/pending-job-banner";

type Phase = "checking" | "uploading" | "done" | "pointer";

/**
 * The other half of send-134's create-form banner picker: whatever the
 * employer staged on `/employer/jobs/new` (new-job-banner-picker.tsx) gets
 * uploaded HERE, once a real jobId exists — the exact same
 * /api/employer/job-banner route job-banner-upload.tsx already uses.
 *
 * Renders the send-132 pointer text by default (and stays there while
 * nothing was staged), so this is a strict superset of that behavior rather
 * than a replacement: an employer who never touched the banner picker sees
 * exactly what they saw before this existed.
 *
 * ── THE `await Promise.resolve()` BEFORE ANY REAL WORK IS LOAD-BEARING ────
 *
 * React's Strict Mode (on by default in dev) runs an effect, its cleanup,
 * and the effect again on every real mount — entirely SYNCHRONOUSLY, same
 * component instance throughout, purely to catch missing cleanup bugs. That
 * is harmless for an idempotent effect and was actively wrong for this one:
 * `takePendingJobBanner` CONSUMES the staged entry (clears it on read,
 * deliberately — see its own header on why a failed attach must not retry
 * against a later post). The first version of this effect called it
 * immediately: Strict Mode's first (doomed) pass read and cleared the real
 * entry before its own cleanup could stop it, then discarded its result on
 * the very next line (`if (cancelled) return`) — and the second, surviving
 * pass found nothing left, reporting "pointer" even though a banner really
 * was staged. Caught by e2e/employer-new-job-banner.spec.ts failing on a
 * dev server, not by the unit tests, which don't render this component.
 *
 * The fix is one `await` inserted before anything touches storage. Because
 * the mount→cleanup→mount-again dance is entirely synchronous, it has fully
 * finished — the doomed pass's `cancelled` is already `true` — by the time
 * either pass's async function resumes past that first microtask tick. The
 * doomed pass checks `cancelled` and returns without ever calling
 * `takePendingJobBanner`; the surviving pass's own `cancelled` is still
 * `false`, so it is the only one that actually consumes the entry.
 *
 * ── A FAILED DEFERRED UPLOAD DEGRADES TO THAT SAME POINTER, ON PURPOSE ────
 *
 * Not a distinct error state. Whatever went wrong (network blip, the
 * storage bucket refusing the write), the employer's next step is identical
 * to "I never picked one" — go to Edit — so there's no separate failure copy
 * to keep in sync with it. Silently doing nothing was the one outcome to
 * avoid: this always leaves either a success line or the same actionable
 * pointer, never neither.
 */
export function PostSuccessBannerNote({ jobId, userId }: { jobId: string; userId: string }) {
  const [phase, setPhase] = useState<Phase>("checking");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // See this component's own header — the doomed Strict Mode pass must
      // clear itself out (its cleanup fires synchronously, before this line
      // is ever reached) before either pass is allowed to touch storage.
      await Promise.resolve();
      if (cancelled) return;

      const file = await takePendingJobBanner(userId).catch(() => null);
      if (cancelled) return;
      if (!file) {
        setPhase("pointer");
        return;
      }

      setPhase("uploading");
      try {
        const body = new FormData();
        body.set("jobId", jobId);
        body.set("file", file);
        const res = await fetch("/api/employer/job-banner", { method: "POST", body });
        if (!cancelled) setPhase(res.ok ? "done" : "pointer");
      } catch {
        if (!cancelled) setPhase("pointer");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [jobId, userId]);

  if (phase === "checking") {
    // Same default as "pointer" while the sessionStorage check (synchronous
    // in practice, but still inside an effect) resolves — avoids a flash of
    // blank space on the far more common path where nothing was staged.
    return <BannerPointer jobId={jobId} />;
  }
  if (phase === "uploading") {
    return <p className="mt-3 font-body text-[13px] text-ink-soft">Adding your banner…</p>;
  }
  if (phase === "done") {
    return <p className="mt-3 font-body text-[13px] text-ink-soft">Banner added.</p>;
  }
  return <BannerPointer jobId={jobId} />;
}

function BannerPointer({ jobId }: { jobId: string }) {
  return (
    <p className="mt-3 font-body text-[13px] text-ink-soft">
      You can add a banner image on{" "}
      <Link
        href={`/employer/jobs/${jobId}/edit`}
        className="font-semibold text-rust underline underline-offset-2"
      >
        this job&apos;s edit page
      </Link>
      .
    </p>
  );
}
