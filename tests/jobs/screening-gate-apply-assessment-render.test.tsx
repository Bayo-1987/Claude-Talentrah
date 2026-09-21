/**
 * send-448 — instructions is now optional on a job posting's assessment
 * (parseJobPostingAssessmentForm no longer hard-blocks a blank field). The
 * seeker-facing render (ScreeningGateApply, the same component the public
 * job-detail page mounts for the apply-gate) previously rendered
 * `renderJobDescriptionMarkdown(assessment.instructions)` unconditionally —
 * with instructions now genuinely nullable, that would render an empty
 * `<div>` with nothing in it. This pins the fix: the instructions block is
 * now conditional on real content, the same way an optional section
 * elsewhere in this app already skips itself rather than rendering empty.
 *
 * Static-render only (react-dom/server), matching
 * empty-skills-notice-render.test.tsx's own pattern — this checks what the
 * assessment section renders for a given prop shape, not the form's
 * interactive behaviour (already covered by
 * e2e/job-posting-assessment.spec.ts and the reconcile-level tests in
 * tests/employer/assessment-response.test.ts).
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ScreeningGateApply, type PublicAssessment } from "@/components/jobs/screening-gate-apply";

// Same convention tests/tracker/sent-resume-fallback.test.tsx already uses:
// this is a static render, never a real navigation, so a no-op stub is
// enough to satisfy ScreeningGateApply's own top-level useRouter() call.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

const BASE_ASSESSMENT: PublicAssessment = {
  title: "Take-home SQL exercise",
  instructions: null,
  exerciseFiles: [],
  exerciseLink: "https://example.com/exercise-brief",
  required: true,
};

function renderWith(assessment: PublicAssessment): string {
  return renderToStaticMarkup(
    <ScreeningGateApply jobId="11111111-1111-1111-1111-111111111111" countryState="explicit" questions={[]} assessment={assessment} />,
  );
}

describe("ScreeningGateApply's assessment section, with instructions null (send-448)", () => {
  it("still shows the title, required marker, and the real link", () => {
    const html = renderWith(BASE_ASSESSMENT);
    expect(html).toContain("Take-home SQL exercise");
    expect(html).toContain("https://example.com/exercise-brief");
  });

  it("renders no empty instructions block — the markdown renderer is never called with null", () => {
    const html = renderWith(BASE_ASSESSMENT);
    // renderJobDescriptionMarkdown's own output for real content always
    // wraps in at least one <p> — with instructions null, none of that
    // markup should exist at all, not just be empty.
    expect(html).not.toMatch(/<div[^>]*class="[^"]*leading-relaxed[^"]*"[^>]*><\/div>/);
  });

  it("shows the instructions block when instructions IS present — the common case is unaffected", () => {
    const html = renderWith({ ...BASE_ASSESSMENT, instructions: "Read the attached brief and reply." });
    expect(html).toContain("Read the attached brief and reply.");
  });
});
