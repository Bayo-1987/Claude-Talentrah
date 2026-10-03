/**
 * The privacy policy describes job links truthfully (S1-43 follow-up, approved wording). Talentrah fetches no job link for tailoring: a
 * seeker PASTES a job description. The one place a link is fetched is the employer careers-page import, where the employer supplies the
 * link. The policy said "pasted or linked job postings you ask Farah to analyze", which promised a seeker feature that does not exist.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown }) => <a href={p.href}>{p.children as never}</a> }));

const { default: PrivacyPolicyPage } = await import("@/app/legal/privacy/page");

describe("the privacy policy's job-description line", () => {
  const text = renderToStaticMarkup(<PrivacyPolicyPage />).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/&#x27;|&quot;/g, "'");

  it("separates what a seeker pastes from what an employer asks us to import", () => {
    expect(text).toContain("Job descriptions and job-posting links you submit");
    expect(text).toContain("job descriptions you paste for Farah to analyze or tailor a resume against");
    expect(text).toContain("for employers, links to a careers page or job posting you ask us to import (we fetch that page to read the posting)");
  });

  it("no longer says seekers' job postings are 'linked'", () => {
    expect(text).not.toContain("pasted or linked job postings");
  });

  it("carries the new last-updated date", () => {
    expect(text).toContain("October 3, 2026");
    expect(text).not.toContain("September 16, 2026");
  });
});
