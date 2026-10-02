/**
 * EMP-1 — the pieces are only worth anything if the REAL form uses them: the
 * currency select defaults from the country the page passes in and shows the
 * stored value on an edit, the Farah button carries the SVG mark, and the
 * assessment files section is part of the form (not a card beside it).
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/employer/draft-job-action", () => ({ draftJobWithFarahAction: async () => ({}) }));
vi.mock("@/lib/employer/pending-job-assessment-files", () => ({
  CREATE_SCOPE: "create",
  clearIfNothingStagedThisSession: () => {},
  writePendingAssessmentFiles: async () => {},
}));

import { JobPostingForm, type JobFormValues } from "@/components/employer/job-posting-form";

const noop = async () => null;

function selectedCurrency(html: string): string[] {
  const select = /<select[^>]*name="salaryCurrency"[\s\S]*?<\/select>/.exec(html)?.[0] ?? "";
  return [...select.matchAll(/<option value="([^"]*)"[^>]*\sselected/g)].map((m) => m[1]!);
}

const STORED: JobFormValues = {
  title: "Backend Engineer",
  location: "London",
  description: "x".repeat(60),
  workType: null,
  employmentType: null,
  seniority: null,
  yearsExperienceMin: null,
  expiresAt: null,
  salaryMin: 50000,
  salaryMax: 70000,
  salaryCurrency: "GBP",
  salaryUnit: "year",
  skills: [],
};

describe("JobPostingForm wiring", () => {
  it("a new posting preselects the country default the page passes", () => {
    const html = renderToStaticMarkup(
      <JobPostingForm action={noop} submitLabel="Publish" pendingLabel="…" defaultSalaryCurrency="GHS" />,
    );
    expect(selectedCurrency(html)).toEqual(["GHS"]);
  });

  it("with no default passed, a new posting is NGN", () => {
    const html = renderToStaticMarkup(<JobPostingForm action={noop} submitLabel="Publish" pendingLabel="…" />);
    expect(selectedCurrency(html)).toEqual(["NGN"]);
  });

  it("the edit form shows the stored currency, not the country default", () => {
    const html = renderToStaticMarkup(
      <JobPostingForm
        action={noop}
        submitLabel="Save"
        pendingLabel="…"
        initial={STORED}
        defaultSalaryCurrency="KES"
      />,
    );
    expect(selectedCurrency(html)).toEqual(["GBP"]);
  });

  it("the salary currency is not a free-text input anywhere on the form", () => {
    const html = renderToStaticMarkup(<JobPostingForm action={noop} submitLabel="Publish" pendingLabel="…" />);
    expect(html).not.toMatch(/<input[^>]*name="salaryCurrency"/);
  });

  it("the Farah button has the SVG mark and an accessible name of just its words", () => {
    const html = renderToStaticMarkup(<JobPostingForm action={noop} submitLabel="Publish" pendingLabel="…" />);
    const button = /<button[^>]*>(?:(?!<\/button>)[\s\S])*Let Farah scope this job<\/button>/.exec(html)?.[0];
    expect(button).toBeDefined();
    expect(button).toContain("<svg");
    expect(html).not.toContain("✦");
  });

  it("Create: the exercise-files section is inside the form, hidden until the assessment is ticked", () => {
    const html = renderToStaticMarkup(
      <JobPostingForm
        action={noop}
        submitLabel="Publish"
        pendingLabel="…"
        assessmentCreateContext={{ userId: "u1" }}
      />,
    );
    const form = /<form[\s\S]*<\/form>/.exec(html)?.[0] ?? "";
    expect(form).toContain('id="assessment-exercise-files"');
    expect(/<div[^>]*id="assessment-exercise-files"[^>]*>/.exec(form)?.[0]).toMatch(/\shidden/);
  });
});
