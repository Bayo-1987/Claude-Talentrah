/**
 * The "Clear example content, keep structure" control (Stage 18 item 4) —
 * rendered by PrintButton (src/components/resume-builder/print-button.tsx)
 * next to the existing export-guard message.
 *
 * This is a render-structure test, not an interaction test: this repo's
 * vitest config runs in `environment: "node"` with no jsdom/testing-library
 * (see tests/resume-builder/template-rendering.test.tsx and
 * resume-editor-label-association.test.tsx for the same constraint), so
 * `onClick` cannot actually be fired here. `clearFlaggedExampleFields` — the
 * function the control calls — has its own full behavioral coverage in
 * example-guard.test.ts; what this file pins down is that the control only
 * appears when there is something to clear, and only when the caller (i.e.
 * resume-editor.tsx) actually wires up `onClearExample`.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PrintButton } from "@/components/resume-builder/print-button";
import { PREVIEW_SAMPLE_RESUME } from "@/lib/resume-builder/preview-sample";
import { EMPTY_RESUME } from "@/lib/resume/types";

describe("PrintButton's clear-example control", () => {
  it("appears alongside the guard message when the resume is still the untouched example", () => {
    const html = renderToStaticMarkup(
      <PrintButton resumeId="r1" content={PREVIEW_SAMPLE_RESUME} onClearExample={() => {}} />,
    );
    expect(html).toContain("Clear example content, keep structure");
    // The Download button must still render disabled while flags exist.
    expect(html).toContain("disabled=\"\"");
  });

  it("does not appear once nothing is flagged — a blank resume has nothing to clear", () => {
    const html = renderToStaticMarkup(
      <PrintButton resumeId="r1" content={EMPTY_RESUME} onClearExample={() => {}} />,
    );
    expect(html).not.toContain("Clear example content");
  });

  it("does not appear when the caller doesn't wire up onClearExample", () => {
    const html = renderToStaticMarkup(<PrintButton resumeId="r1" content={PREVIEW_SAMPLE_RESUME} />);
    expect(html).not.toContain("Clear example content");
    // The rest of the guard message is unaffected by the prop being absent.
    expect(html).toContain("Still the example content");
  });
});
