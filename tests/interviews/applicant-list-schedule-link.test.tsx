/** MESSAGE-ENTRY-1 (schedule half): the applicants list links each applicant to the Schedule interview page (it was reachable by URL only). */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ApplicantRow } from "@/components/employer/applicant-list";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
import { ApplicantList } from "@/components/employer/applicant-list";

const row = (id: string, resumeId: string | null): ApplicantRow => ({
  application_id: id,
  first_name: "Joy",
  last_name: id,
  applied_at: "2026-10-01T00:00:00Z",
  match_score: 70,
  resume_id: resumeId,
  status: "new" as ApplicantRow["status"],
  explanation: null,
  resumeReview: null,
  resumeReviewedAt: null,
  screeningPassed: null,
});
const render = (rows: ApplicantRow[]) => renderToStaticMarkup(<ApplicantList jobId="job-1" applicants={rows} hasScreeningQuestions={false} hasAssessment={false} />);

describe("applicants list: entry link to Offer interview times", () => {
  it("every applicant has an 'Offer interview times' link to that application's schedule page", () => {
    const html = render([row("app-a", "r1"), row("app-b", null)]);
    expect(html.match(/Offer interview times/g)?.length).toBe(2);
    expect(html).toContain('href="/employer/jobs/job-1/applicants/app-a/schedule"');
    expect(html).toContain('href="/employer/jobs/job-1/applicants/app-b/schedule"');
  });

  it("sits beside the Message candidate link without replacing it, and the URL carries no personal data", () => {
    const html = render([row("app-c", "r1")]);
    expect(html).toContain('href="/employer/jobs/job-1/applicants/app-c/message"');
    const hrefs = [...html.matchAll(/href="([^"]*schedule[^"]*)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(["/employer/jobs/job-1/applicants/app-c/schedule"]);
    expect(hrefs.join()).not.toMatch(/@|\?/);
  });
});
