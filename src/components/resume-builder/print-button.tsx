"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { findUneditedExampleFields, describeExampleGuardError } from "@/lib/resume-builder/example-guard";
import { recordResumeBuilderCompletionAction } from "@/lib/resume-builder/actions";
import type { StructuredResume } from "@/lib/resume/types";

/**
 * PDF export via the browser's native print-to-PDF, per plan doc M4 — no
 * server-side PDF library needed. DOCX export is explicitly not implemented
 * in Phase 1.
 *
 * BLOCKS EXPORT while the resume still has unedited "Start from an example"
 * placeholder content (findUneditedExampleFields, checked against
 * PREVIEW_SAMPLE_RESUME) — "a user emailing a recruiter a CV that still says
 * the example email is a worse outcome than the blank-page problem this
 * feature exists to fix." A blank-start or freshly-imported resume never
 * matches the example content field-for-field, so this never fires for
 * those; see example-guard.ts for exactly how and why.
 */
export function PrintButton({ resumeId, content }: { resumeId: string; content: StructuredResume }) {
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    const flags = findUneditedExampleFields(content);
    if (flags.length > 0) {
      setError(describeExampleGuardError(flags));
      return;
    }
    setError(null);
    // Best-effort, fire-and-forget — see start-events.ts. Not awaited: a slow
    // or dropped analytics write must never delay the export the user asked
    // for.
    void recordResumeBuilderCompletionAction(resumeId);
    window.print();
  }

  return (
    <div className="flex flex-col items-end gap-2 print:hidden">
      <Button size="sm" onClick={handleClick}>
        Download PDF
      </Button>
      {error && <p className="max-w-[260px] text-right text-[12.5px] text-rust">{error}</p>}
    </div>
  );
}
