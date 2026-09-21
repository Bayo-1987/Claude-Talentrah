"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { takePendingAssessmentFiles } from "@/lib/employer/pending-job-assessment-files";

type Phase = "checking" | "idle" | "uploading" | "done" | "partial";

/**
 * The other half of the create-form file picker (send-364): whatever the
 * employer staged on /employer/jobs/new (new-job-assessment-files-picker.tsx)
 * gets uploaded HERE, once a real jobId exists — the exact same
 * /api/employer/job-assessment-exercise route assessment-exercise-upload.tsx
 * (Edit) already uses, called once per staged file since that route accepts
 * one file per call.
 *
 * send-449 reuses this SAME component for a second caller: the Edit page's
 * own first-time-attaching-an-assessment case (EditJobAssessmentFilesPicker
 * stages under this job's own real id, not CREATE_SCOPE). `scope` is an
 * explicit, required prop rather than a default — the two callers stage
 * under genuinely different keys (pending-job-assessment-files.ts's own
 * header explains why), and a wrong default here would silently look up
 * the OTHER caller's staged files instead of failing loudly.
 *
 * Renders NOTHING by default (unlike PostSuccessBannerNote, which always
 * shows a persistent "add one from Edit" pointer even with nothing staged)
 * — there is no equivalent standing affordance this note needs to point at
 * when nothing was picked, since Edit's own AssessmentExerciseUpload only
 * ever appears once an assessment exists, and this page has no way to know
 * in advance whether one does.
 *
 * ── SAME STRICT-MODE DOUBLE-INVOKE GUARD AS PostSuccessBannerNote ──────────
 *
 * `takePendingAssessmentFiles` CONSUMES the staged entry (clears it on
 * read). The `await Promise.resolve()` before touching storage exists for
 * the identical reason documented on PostSuccessBannerNote: React Strict
 * Mode's synchronous mount→cleanup→mount-again dance must fully finish
 * (the doomed first pass's `cancelled` flag set) before either pass is
 * allowed past that first microtask tick, so only the surviving pass
 * actually consumes the entry.
 *
 * ── PARTIAL FAILURE IS REPORTED HONESTLY, NOT HIDDEN ────────────────────────
 *
 * Files upload one at a time (sequentially, not in parallel — this route
 * enforces a per-assessment cap server-side, and parallel calls would just
 * race each other against the exact same check the trigger already closes
 * more cheaply one at a time). If some succeed and some fail — most
 * plausibly because the employer never actually enabled "Attach an
 * assessment" below, so every upload hits the same "no assessment yet"
 * error — this says so and points at Edit, rather than claiming success or
 * silently swallowing the failures. Same "apply first, attach second,
 * report a partial failure honestly" stance this whole feature already
 * takes elsewhere (applyWithScreeningAction, postJobAction's own screening/
 * assessment reconcile calls).
 */
export function PostSuccessAssessmentFilesNote({
  jobId,
  userId,
  scope,
}: {
  jobId: string;
  userId: string;
  /** CREATE_SCOPE for the Create-page caller, or this job's own real id for
   * the Edit-page caller — see this component's own header. */
  scope: string;
}) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [counts, setCounts] = useState({ succeeded: 0, total: 0 });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      await Promise.resolve();
      if (cancelled) return;

      const files = await takePendingAssessmentFiles(scope, userId).catch(() => [] as File[]);
      if (cancelled) return;
      if (files.length === 0) {
        setPhase("idle");
        return;
      }

      setPhase("uploading");
      let succeeded = 0;
      for (const file of files) {
        if (cancelled) return;
        try {
          const body = new FormData();
          body.set("jobId", jobId);
          body.set("file", file);
          const res = await fetch("/api/employer/job-assessment-exercise", { method: "POST", body });
          if (res.ok) succeeded += 1;
        } catch {
          // Counted as a failure below — succeeded is simply not incremented.
        }
      }
      if (cancelled) return;
      setCounts({ succeeded, total: files.length });
      setPhase(succeeded === files.length ? "done" : "partial");
    })();

    return () => {
      cancelled = true;
    };
  }, [jobId, userId, scope]);

  if (phase === "checking" || phase === "idle") return null;
  if (phase === "uploading") {
    return <p className="mt-3 font-body text-[13px] text-ink-soft">Adding your assessment files…</p>;
  }
  if (phase === "done") {
    return <p className="mt-3 font-body text-[13px] text-ink-soft">Assessment files added.</p>;
  }
  return (
    <p className="mt-3 font-body text-[13px] text-ink-soft">
      {counts.succeeded} of {counts.total} file{counts.total === 1 ? "" : "s"} attached. Add the rest from{" "}
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
