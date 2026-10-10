/**
 * MESSAGE-ENTRY-1: the applicants list links each applicant to the Message candidate page (it used to be reachable by URL only). QA proves the click from the list in a browser; this pins the
 * markup: one link per applicant, the right href, and not conditional on the applicant having a resume.
 */
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

describe("applicants list: entry link to Message candidate", () => {
  it("every applicant has a 'Message candidate' link to that application's message page", () => {
    const html = render([row("app-a", "resume-1"), row("app-b", "resume-2")]);
    expect(html.match(/Message candidate/g)?.length).toBe(2);
    expect(html).toContain('href="/employer/jobs/job-1/applicants/app-a/message"');
    expect(html).toContain('href="/employer/jobs/job-1/applicants/app-b/message"');
  });

  it("an applicant with no resume is still messageable (the link does not depend on a resume), and has no 'View resume' link", () => {
    const html = render([row("app-c", null)]);
    expect(html).toContain('href="/employer/jobs/job-1/applicants/app-c/message"');
    expect(html).not.toContain("View resume");
  });

  it("the existing 'View resume' link and the status control are unchanged", () => {
    const html = render([row("app-d", "resume-1")]);
    expect(html).toContain('href="/employer/jobs/job-1/applicants/app-d/resume"');
    expect(html).toContain('aria-label="Applicant status"');
  });

  it("the link never carries an email address or any personal detail in the URL", () => {
    const html = render([row("app-e", "resume-1")]);
    const hrefs = [...html.matchAll(/href="([^"]*message[^"]*)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(["/employer/jobs/job-1/applicants/app-e/message"]);
    expect(hrefs.join()).not.toMatch(/@|\?/);
  });
});
