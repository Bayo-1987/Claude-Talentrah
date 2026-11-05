/**
 * PR-E2b: Jobs Posted for a job whose applications arrive by email: it says so, and shows no applicant count and no "N new" badge (nobody applies inside Talentrah). The address itself never
 * reaches the row (a flag does). A job that takes applications on Talentrah shows exactly what it showed before.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { PostedJobRow, type PostedJob } from "@/components/employer/posted-job-row";

const BASE: PostedJob = {
  id: "11111111-1111-1111-1111-111111111111", title: "Backend Engineer", location: "Lagos", status: "open", removalReason: null, postedAt: new Date().toISOString(), applicationCount: 0,
  workType: null, employmentType: null, unlistedAt: null, adminReviewRequestedAt: null, adminReviewDecision: null,
};
const render = (job: Partial<PostedJob>) => renderToStaticMarkup(<PostedJobRow job={{ ...BASE, ...job }} orgVerified={true} origin="https://talentrah.example" />);

describe("Jobs Posted row", () => {
  it("an email job says 'Applications arrive by email' and shows no count, no link to applicants and no 'new' badge", () => {
    const html = render({ appliesByEmail: true, applicationCount: 3, newApplicantCount: 2 });
    expect(html).toContain("Applications arrive by email");
    expect(html).not.toMatch(/applications?<|\bnew\b</);
    expect(html).not.toContain("/applicants");
  });
  it("Report and Edit stay available on an email job", () => {
    const html = render({ appliesByEmail: true });
    expect(html).toContain(`/employer/jobs/${BASE.id}/edit`);
  });
  it("an ordinary job with no applications shows '0 applications', unchanged", () => {
    const html = render({});
    expect(html).toContain("0 applications");
    expect(html).not.toContain("arrive by email");
  });
  it("an ordinary job with applications still links the count to the applicants", () => {
    const html = render({ applicationCount: 2, newApplicantCount: 1 });
    expect(html).toContain("2 applications");
    expect(html).toContain("/applicants");
    expect(html).toContain("1 new");
  });
});

describe("the other employer pages (source)", () => {
  const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8").replace(/\s+/g, " ");

  it("the applicants page says applications arrive by email instead of listing them, for such a job", () => {
    const src = read("src/app/employer/jobs/[id]/applicants/page.tsx");
    expect(src).toContain('.select("id, title, apply_email")');
    expect(src).toContain("{takesApplicationsByEmail(job) && (");
    expect(src).toContain("Applications for this job arrive by email, so they are not listed here.");
  });
  it("the edit page prefills the address from a read of its own, so JOB_EDIT_COLUMNS stays free of the column", () => {
    const src = read("src/app/employer/jobs/[id]/edit/page.tsx");
    expect(src).toContain("applyEmail: postingApplyEmail(applyRow)");
    expect(src).toContain('.select("apply_email")');
    expect(read("src/lib/jobs/job-columns.ts")).not.toMatch(/JOB_EDIT_COLUMNS =\s*"[^"]*apply_email/);
  });
  it("Jobs Posted passes a flag to the row, never the address", () => {
    const src = read("src/app/employer/jobs/page.tsx");
    expect(src).toContain("appliesByEmail: takesApplicationsByEmail(job),");
    expect(src).not.toMatch(/apply_email:\s*job\.|applyEmail:/);
  });
});
