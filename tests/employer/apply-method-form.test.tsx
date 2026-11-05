/**
 * PR-E2b: the employer's job form asks "How should people apply?". On Talentrah is the default and the only state of an existing job; By email reveals the address, the tick and the two plain
 * warnings, and hides the screening questions and the assessment. The real form is rendered (server-side, so the default state only); the field's other state is rendered on its own.
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
import { ApplyMethodField } from "@/components/employer/apply-method-field";

const noop = async () => null;
const BASE: JobFormValues = { title: "Backend Engineer", location: "London", description: "x".repeat(60), workType: null, employmentType: null, seniority: null, yearsExperienceMin: null, expiresAt: null, salaryMin: null, salaryMax: null, salaryCurrency: null, salaryUnit: null, skills: ["javascript"] };
/** The <input> for a radio by value, whatever order React prints its attributes in. */
const radio = (html: string, value: string) => new RegExp(`<input[^>]*name="applyMethod"[^>]*value="${value}"[^>]*>|<input[^>]*value="${value}"[^>]*name="applyMethod"[^>]*>`).exec(html)?.[0] ?? "";
const form = (initial?: JobFormValues) => renderToStaticMarkup(<JobPostingForm action={noop} initial={initial} submitLabel="Save" pendingLabel="Saving…" />);

describe("the form", () => {
  it("asks 'How should people apply?' with 'On Talentrah' checked by default, and shows no address field", () => {
    const html = form();
    expect(html).toContain("How should people apply?");
    expect(radio(html, "talentrah")).toContain("checked");
    expect(radio(html, "email")).not.toContain("checked");
    expect(html).not.toMatch(/name="applyEmail"/);
    expect(html).not.toMatch(/name="applyEmailConfirm"/);
  });
  it("still shows the screening questions and the assessment for an ordinary job", () => {
    const html = form();
    expect(html).toContain("Screening questions");
    expect(html).toMatch(/name="screeningQuestions"|Screening questions/);
  });
  it("a job that already takes email opens with 'By email' checked, the address filled in, and the screening sections hidden", () => {
    const html = form({ ...BASE, applyEmail: "careers@example.test" });
    expect(radio(html, "email")).toContain("checked");
    expect(radio(html, "talentrah")).not.toContain("checked");
    expect(html).toContain('value="careers@example.test"');
    expect(html).toContain("are not used for a job that takes applications by email");
  });
});

describe("the field", () => {
  const render = (method: "talentrah" | "email") =>
    renderToStaticMarkup(<ApplyMethodField method={method} onMethodChange={() => {}} address="" onAddressChange={() => {}} confirmed={false} onConfirmedChange={() => {}} />);

  it("By email: an email input, the tick with the owner's wording, and both plain warnings (the address is public; Talentrah does not forward resumes)", () => {
    const html = render("email");
    expect(html).toMatch(/<input[^>]*type="email"[^>]*name="applyEmail"|<input[^>]*name="applyEmail"[^>]*type="email"/);
    expect(html).toContain('name="applyEmailConfirm"');
    expect(html).toContain("I confirm this address is ours and may be shown publicly");
    expect(html).toContain("anyone who uses them can read it, including automated tools");
    expect(html).toContain("Talentrah does not forward resumes");
    expect(html).toContain("no applicant list, screening questions or resume checks");
  });
  it("On Talentrah: none of that", () => {
    const html = render("talentrah");
    expect(html).not.toContain("applyEmail");
    expect(html).not.toContain("forward resumes");
  });
  it("uses the house word 'resume', never 'CV'", () => {
    expect(render("email")).not.toMatch(/\bCVs?\b/);
  });
});
