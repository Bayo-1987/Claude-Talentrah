/**
 * PR-E4 gate 2: the third choice on the employer's form, "On our career site". The field is rendered on its own in each state (the form's state is client-side). A verified company may use its own
 * website or an applicant-tracking page; an unverified one is told that only an applicant-tracking page is available and why. The careers-page tick names the host. Screening sections stay hidden.
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

import { ApplyMethodField } from "@/components/employer/apply-method-field";
import { JobPostingForm, type JobFormValues } from "@/components/employer/job-posting-form";

const noop = () => {};
const field = (props: Record<string, unknown>) =>
  renderToStaticMarkup(
    <ApplyMethodField
      method="link"
      onMethodChange={noop}
      address=""
      onAddressChange={noop}
      confirmed={false}
      onConfirmedChange={noop}
      linkUrl=""
      onLinkUrlChange={noop}
      linkConfirmed={false}
      onLinkConfirmedChange={noop}
      companyDomain="acme.example"
      companyVerified
      companyName="Acme"
      {...props}
    />,
  );
const radio = (html: string, value: string) => new RegExp(`<input[^>]*name="applyMethod"[^>]*value="${value}"[^>]*>|<input[^>]*value="${value}"[^>]*name="applyMethod"[^>]*>`).exec(html)?.[0] ?? "";

describe("the field", () => {
  it("offers three choices, the third being 'On our career site'", () => {
    const html = field({});
    expect(html).toContain("On Talentrah");
    expect(html).toContain("By email");
    expect(html).toContain("On our career site");
    expect(radio(html, "link")).toContain("checked");
    expect(radio(html, "talentrah")).not.toContain("checked");
  });
  it("with the choice made: an address input, what is accepted, and the two plain warnings (seekers leave Talentrah; nothing reaches your dashboard)", () => {
    const html = field({});
    expect(html).toMatch(/<input[^>]*name="applyLinkUrl"[^>]*>/);
    expect(html).toContain("acme.example");
    expect(html).toMatch(/leave Talentrah/i);
    expect(html).toMatch(/applicant list, screening questions or resume checks/i);
    expect(html).not.toMatch(/\bCVs?\b/);
  });
  it("a verified company is told both ways in; the careers-page tick is NOT shown for a link on its own domain", () => {
    const html = field({ linkUrl: "https://careers.acme.example/jobs" });
    expect(html).toMatch(/your company's website|your own website/i);
    expect(html).not.toContain('name="applyLinkConfirm"');
  });
  it("an applicant-tracking page shows the tick, worded with the host", () => {
    const html = field({ linkUrl: "https://boards.greenhouse.io/acme" });
    expect(html).toContain('name="applyLinkConfirm"');
    expect(html).toContain("This is our own careers page on boards.greenhouse.io");
  });
  it("A1: an unverified company is told that only an applicant-tracking page is available, and why", () => {
    const html = field({ companyVerified: false, companyDomain: null });
    expect(html).toMatch(/isn(?:'|&#x27;)t verified yet/i); // React escapes the apostrophe in rendered text
    expect(html).toMatch(/applicant tracking/i);
    expect(html).toMatch(/Greenhouse|Lever/);
  });
  it("without the choice the link fields are not on the page", () => {
    const html = field({ method: "talentrah" });
    expect(html).not.toContain("applyLinkUrl");
    expect(html).not.toContain("applyLinkConfirm");
  });
  it("the e-mail state is unchanged: its field and tick are still there", () => {
    const html = field({ method: "email" });
    expect(html).toContain('name="applyEmail"');
    expect(html).toContain('name="applyEmailConfirm"');
    expect(html).not.toContain("applyLinkUrl");
  });
});

describe("the form", () => {
  const BASE: JobFormValues = { title: "Backend Engineer", location: "London", description: "x".repeat(60), workType: null, employmentType: null, seniority: null, yearsExperienceMin: null, expiresAt: null, salaryMin: null, salaryMax: null, salaryCurrency: null, salaryUnit: null, skills: ["javascript"] };
  const form = (initial?: JobFormValues, extra: Record<string, unknown> = {}) => renderToStaticMarkup(<JobPostingForm action={async () => null} initial={initial} submitLabel="Save" pendingLabel="Saving…" {...extra} />);

  it("a job that already has a link opens with 'On our career site' chosen, the address filled in, and the screening sections hidden", () => {
    const html = form({ ...BASE, applyLink: "https://careers.acme.example/jobs" }, { companyDomain: "acme.example", companyVerified: true, companyName: "Acme" });
    expect(radio(html, "link")).toContain("checked");
    expect(html).toContain('value="https://careers.acme.example/jobs"');
    expect(html).toContain("are not used for a job that");
  });
  it("an ordinary job still opens On Talentrah, with the screening sections", () => {
    const html = form(undefined, { companyDomain: "acme.example", companyVerified: true, companyName: "Acme" });
    expect(radio(html, "talentrah")).toContain("checked");
    expect(html).toContain("Screening questions");
  });
});
