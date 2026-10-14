/**
 * The applicant card: "View assessment response" is a LINK to its own page (like View resume); "View resume" is exactly what it was. Rendered directly (no database).
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
import { ApplicantList, type ApplicantRow } from "@/components/employer/applicant-list";

const ID = "11111111-1111-1111-1111-111111111111";
const RESUME_ID = "22222222-2222-2222-2222-222222222222";
const row = (over: Partial<ApplicantRow> = {}): ApplicantRow => ({
  application_id: ID, first_name: "Test", last_name: "Applicant", applied_at: "2026-01-01T00:00:00Z", match_score: 70, resume_id: RESUME_ID, status: "applied" as ApplicantRow["status"],
  explanation: null, resumeReview: null, resumeReviewedAt: null, screeningPassed: null, ...over,
});
const render = (hasAssessment: boolean, over: Partial<ApplicantRow> = {}) =>
  renderToStaticMarkup(<ApplicantList jobId="j1" applicants={[row(over)]} hasScreeningQuestions={false} hasAssessment={hasAssessment} />);

describe("View assessment response is a link", () => {
  it("to /employer/jobs/<job>/applicants/<application>/assessment, with the same look as before", () => {
    const html = render(true);
    expect(html).toContain(`<a class="mt-0.5 block min-h-6 font-body text-[12.5px] font-semibold text-ink underline underline-offset-2 hover:text-rust" href="/employer/jobs/j1/applicants/${ID}/assessment">View assessment response</a>`);
  });
  it("it is no longer a button, and the inline 'Hide assessment response' panel is gone", () => {
    const html = render(true);
    expect(html).not.toMatch(/<button[^>]*>\s*View assessment response/);
    expect(html).not.toContain("Hide assessment response");
    expect(html).not.toContain("Loading response");
  });
  it("a job with no assessment has no such link", () => {
    expect(render(false)).not.toContain("assessment");
  });
});

describe("View resume is unchanged", () => {
  it("the link is exactly what it was: same address, same classes, same words", () => {
    const html = render(true);
    expect(html).toContain(`<a class="font-body text-[13px] font-semibold text-ink underline underline-offset-2 hover:text-rust" href="/employer/jobs/j1/applicants/${ID}/resume">View resume</a>`);
  });
  it("no resume, no link; and the assessment link does not change that", () => {
    const html = render(true, { resume_id: null });
    expect(html).not.toContain("View resume");
    expect(html).toContain("View assessment response");
  });
  it("there is no 'Download PDF' on the card, before or after (that control lives on the resume and assessment pages)", () => {
    expect(render(true)).not.toMatch(/Download PDF/i);
  });
});
