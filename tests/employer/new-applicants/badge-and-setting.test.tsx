/**
 * The "N new" badge on Jobs Posted (PostedJobRow) and the setting control, rendered directly. The existing row (counts, links, Path 3 states) must read exactly as before when no new count is given.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PostedJobRow, type PostedJob } from "@/components/employer/posted-job-row";
import { NewApplicantNoticeSelect } from "@/components/employer/new-applicant-notice-select";

const BASE: PostedJob = {
  id: "11111111-1111-1111-1111-111111111111",
  title: "Backend Engineer",
  location: "Lagos",
  status: "open",
  removalReason: null,
  postedAt: new Date().toISOString(),
  applicationCount: 0,
  workType: null,
  employmentType: null,
  unlistedAt: null,
  adminReviewRequestedAt: null,
  adminReviewDecision: null,
};
const render = (job: Partial<PostedJob>) => renderToStaticMarkup(<PostedJobRow job={{ ...BASE, ...job }} orgVerified={false} origin="https://talentrah.example" />);

describe("the 'N new' badge on a Jobs Posted row", () => {
  it("shows '2 new' as a link to the applicants page next to the application count", () => {
    const html = render({ applicationCount: 5, newApplicantCount: 2 });
    expect(html).toContain("5 applications");
    expect(html).toContain("2 new");
    expect(html.match(/href="\/employer\/jobs\/11111111-1111-1111-1111-111111111111\/applicants"/g)?.length).toBe(2);
  });

  it("shows nothing when none are new, when the count is absent, or when nobody applied", () => {
    expect(render({ applicationCount: 5, newApplicantCount: 0 })).not.toContain(" new<");
    expect(render({ applicationCount: 5 })).not.toMatch(/\d+ new/);
    expect(render({ applicationCount: 0, newApplicantCount: 3 })).not.toMatch(/\d+ new/);
  });

  it("leaves the row exactly as it was when no new count is given (existing markup unchanged)", () => {
    const withoutProp = render({ applicationCount: 5 });
    const withZero = render({ applicationCount: 5, newApplicantCount: 0 });
    expect(withZero).toBe(withoutProp);
    expect(withoutProp).toContain("5 applications");
    expect(render({ applicationCount: 1 })).toContain("1 application<");
  });
});

describe("the notice setting", () => {
  it("offers instant, daily digest and off with the saved choice selected", () => {
    const html = renderToStaticMarkup(<NewApplicantNoticeSelect initialMode="digest" />);
    expect(html).toContain("Emails about new applicants");
    expect(html).toMatch(/<option value="digest" selected/);
    expect(html).toContain('value="instant"');
    expect(html).toContain('value="off"');
  });
});
