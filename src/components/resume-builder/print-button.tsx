"use client";

import { Button } from "@/components/ui";
import { findUneditedExampleFields, exampleFieldElementId } from "@/lib/resume-builder/example-guard";
import { recordResumeBuilderCompletionAction } from "@/lib/resume-builder/actions";
import type { StructuredResume } from "@/lib/resume/types";

function focusFlaggedField(path: string) {
  const el = document.getElementById(exampleFieldElementId(path));
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  const focusable =
    el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
      ? el
      : el.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
  focusable?.focus();
}

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
 *
 * findUneditedExampleFields is called at render time, not just on click —
 * the button disables and lists what's still flagged before it is ever
 * clicked, instead of the block being discoverable only by clicking a
 * fully-enabled button. resume-editor.tsx renders the matching markers
 * inline (same flags, same source of truth), and each flagged label here is
 * a real button that scrolls to and focuses its field there.
 */
export function PrintButton({ resumeId, content }: { resumeId: string; content: StructuredResume }) {
  const flags = findUneditedExampleFields(content);

  function handleClick() {
    // Defensive re-check — the button below is already disabled while flags
    // exist, but a disabled attribute is a rendering detail, not a guarantee.
    if (findUneditedExampleFields(content).length > 0) return;
    // Best-effort, fire-and-forget — see start-events.ts. Not awaited: a slow
    // or dropped analytics write must never delay the export the user asked
    // for.
    void recordResumeBuilderCompletionAction(resumeId);
    window.print();
  }

  return (
    <div className="flex flex-col items-end gap-2 print:hidden">
      <Button size="sm" onClick={handleClick} disabled={flags.length > 0} className="disabled:opacity-50">
        Download PDF
      </Button>
      {flags.length > 0 && (
        <div className="max-w-[260px] text-right text-[12.5px] text-rust">
          <p>Still the example content — update before exporting:</p>
          <p className="mt-1">
            {flags.map((flag, i) => (
              <span key={flag.path}>
                <button
                  type="button"
                  onClick={() => focusFlaggedField(flag.path)}
                  className="underline underline-offset-2 hover:text-ink"
                >
                  {flag.label}
                </button>
                {i < flags.length - 1 && (i === flags.length - 2 ? " and " : ", ")}
              </span>
            ))}
          </p>
        </div>
      )}
    </div>
  );
}
