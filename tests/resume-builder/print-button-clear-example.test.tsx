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
 *
 * REWORKED FOR THE MULTI-PERSONA REGISTRY: PrintButton calls
 * `findUneditedExampleFields`/`clearFlaggedExampleFields`, which now match
 * against ANY persona in `EXAMPLE_PERSONAS`, not just the kept PM one — the
 * `it.each` blocks below run the same assertions against every persona so a
 * regression that broke matching for, say, only the Engineering persona
 * would be caught here too, not just in example-guard.test.ts's own
 * lower-level coverage.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PrintButton } from "@/components/resume-builder/print-button";
import { EXAMPLE_PERSONAS } from "@/lib/resume-builder/preview-sample";
import { EMPTY_RESUME } from "@/lib/resume/types";

describe("PrintButton's clear-example control", () => {
  it.each(EXAMPLE_PERSONAS.map((p) => [p.contact.name, p] as const))(
    "appears alongside the guard message when the resume is still the untouched example (%s)",
    (_name, persona) => {
      const html = renderToStaticMarkup(
        <PrintButton resumeId="r1" content={persona} onClearExample={() => {}} />,
      );
      expect(html).toContain("Clear example content, keep structure");
      // The Download button must still render disabled while flags exist.
      expect(html).toContain('disabled=""');
    },
  );

  it("does not appear once nothing is flagged — a blank resume has nothing to clear", () => {
    const html = renderToStaticMarkup(
      <PrintButton resumeId="r1" content={EMPTY_RESUME} onClearExample={() => {}} />,
    );
    expect(html).not.toContain("Clear example content");
  });

  it.each(EXAMPLE_PERSONAS.map((p) => [p.contact.name, p] as const))(
    "does not appear when the caller doesn't wire up onClearExample (%s)",
    (_name, persona) => {
      const html = renderToStaticMarkup(<PrintButton resumeId="r1" content={persona} />);
      expect(html).not.toContain("Clear example content");
      // The rest of the guard message is unaffected by the prop being absent.
      expect(html).toContain("Still the example content");
    },
  );
});
