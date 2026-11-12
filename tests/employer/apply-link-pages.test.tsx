/**
 * PR-E4 gate 2: the employer's own pages for a job that takes applications on the company's career site. Jobs Posted says where applications go and shows no applicant count; the applicants page says
 * the same; the edit page prefills the address through get_job_apply_link (the column itself is unreadable) and the kind from its own row. The address never reaches the list row.
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
const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8").replace(/\s+/g, " ");

describe("Jobs Posted row", () => {
  it("a career-site job says where applications go, with no count, no applicants link and no 'new' badge; Edit stays", () => {
    const html = render({ appliesByLink: true, applicationCount: 3, newApplicantCount: 2 });
    expect(html).toContain("Applications go to your career site");
    expect(html).not.toMatch(/applications?<|\bnew\b</);
    expect(html).not.toContain("/applicants");
    expect(html).toContain(`/employer/jobs/${BASE.id}/edit`);
  });
  it("an e-mail job keeps its own wording, and an ordinary job its count", () => {
    expect(render({ appliesByEmail: true })).toContain("Applications arrive by email");
    expect(render({})).toContain("0 applications");
  });
});

describe("the other employer pages (source)", () => {
  it("the applicants page says applications go to the career site, per method", () => {
    const src = read("src/app/employer/jobs/[id]/applicants/page.tsx");
    expect(src).toContain('.select("id, title, apply_email, apply_link_kind")');
    expect(src).toContain("Applications for this job go to your career site, so they are not listed here.");
    expect(src).toContain("Applications for this job arrive by email, so they are not listed here.");
  });
  it("the edit page prefills the address through get_job_apply_link and the kind from its own read, never from JOB_EDIT_COLUMNS", () => {
    const src = read("src/app/employer/jobs/[id]/edit/page.tsx");
    expect(src).toContain('.rpc("get_job_apply_link"');
    expect(src).toContain('.select("apply_email, apply_link_kind")');
    expect(src).toContain("applyLink: ");
    expect(src).toContain("companyDomain: ");
    expect(src).toContain("companyVerified: ");
    expect(read("src/lib/jobs/job-columns.ts")).not.toMatch(/JOB_EDIT_COLUMNS =\s*"[^"]*apply_link/);
  });
  it("Jobs Posted passes flags to the row, never the address", () => {
    const src = read("src/app/employer/jobs/page.tsx");
    expect(src).toContain("appliesByLink: takesApplicationsByLink(job),");
    expect(src).not.toMatch(/apply_link:\s*job\.|applyLink:/);
  });
  it("Jobs Posted shows the name-mismatch note when the form's redirect carries it", () => {
    const src = read("src/app/employer/jobs/page.tsx");
    expect(src).toContain('applyLinkNote === "name"');
    expect(src).toContain("The company name in it doesn&apos;t look like yours");
  });
  it("the new-job page gives the form the company's domain only when verified, and its name", () => {
    const src = read("src/app/employer/jobs/new/page.tsx");
    expect(src).toContain("companyVerified={organization.verified}");
    expect(src).toContain("companyDomain={organization.verified ? organization.domain : null}");
  });
});
