/**
 * Copy rule (owner, 13 Oct 2026): the instant email, the digest email and the setting say "new applicant", NEVER "first applicant". The first-applicant flag only means "first since 0254 went live", so
 * calling someone the first applicant would be untrue for a job that already had applicants before then.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildDigestEmail, buildInstantEmail } from "@/lib/employer/new-applicants/emails";
import { NOTICE_LABELS, NOTICE_OPTION_HELP } from "@/lib/employer/new-applicants/notice-mode";
import { INSTANT_FOOTER_SENTENCE } from "@/lib/employer/new-applicants/emails";
import { NewApplicantNoticeSelect } from "@/components/employer/new-applicant-notice-select";
import { PostedJobRow, type PostedJob } from "@/components/employer/posted-job-row";

const FIRST = /first[\s-]+applicant/i;
// The owner's final wording says "first NEW applicant" in the instant footer and the instant option's help line. That is not the banned phrase (the regex above needs "first" directly followed by
// "applicant"), so there is NO allowance any more: every string in every email and in the setting must pass the ban, and the approved sentences are asserted to use the allowed phrase.
const APPROVED = [INSTANT_FOOTER_SENTENCE, NOTICE_OPTION_HELP.instant];

describe("new applicant, never first applicant", () => {
  it("the two approved sentences use 'first new applicant', which is allowed; the same sentences with 'new' removed would fail the ban", () => {
    for (const sentence of APPROVED) {
      expect(sentence).toContain("first new applicant");
      expect(sentence).not.toMatch(FIRST);
      expect(sentence.replace("first new applicant", "first applicant")).toMatch(FIRST); // the mutant: the old wording is caught
    }
  });

  it("the instant email (subject, text, html)", () => {
    const e = buildInstantEmail({ applicantName: "Joy Akindele", jobTitle: "Growth Marketer", applicantsUrl: "https://t.test/a", settingsUrl: "https://t.test/s" });
    expect(e.subject).toBe("New applicant for Growth Marketer");
    for (const part of [e.subject, e.text, e.html]) expect(part).not.toMatch(FIRST);
    // The old footer carried the words "new applicants"; the approved footer does not, so the subject is what carries the phrase now.
    expect(e.subject).toMatch(/new applicant/i);
    expect(e.text).toContain(INSTANT_FOOTER_SENTENCE);
  });

  it("the digest email (subject, text, html), for one and for several", () => {
    const group = { jobId: "j1", jobTitle: "Growth Marketer", count: 1, names: ["Joy Akindele"], applicantsUrl: "https://t.test/a" };
    const one = buildDigestEmail({ groups: [group], settingsUrl: "https://t.test/s" });
    const many = buildDigestEmail({ groups: [group, { ...group, jobId: "j2", jobTitle: "Designer", count: 2, names: ["A", "B"] }], settingsUrl: "https://t.test/s" });
    expect(one.subject).toBe("1 new applicant on Talentrah");
    expect(many.subject).toBe("3 new applicants on Talentrah");
    for (const e of [one, many]) for (const part of [e.subject, e.text, e.html]) expect(part).not.toMatch(FIRST);
  });

  it("every setting label and the rendered control", () => {
    for (const label of Object.values(NOTICE_LABELS)) expect(label).not.toMatch(FIRST);
    // The approved option names no longer contain the words "new applicant" (the setting's own label does); the instant option's approved help line is the one allowed exception.
    expect(renderToStaticMarkup(<NewApplicantNoticeSelect initialMode="digest" />)).not.toMatch(FIRST);
    expect(renderToStaticMarkup(<NewApplicantNoticeSelect initialMode="instant" />)).not.toMatch(FIRST);
  });

  it("the Jobs Posted row with a badge", () => {
    const job: PostedJob = {
      id: "11111111-1111-1111-1111-111111111111", title: "Backend Engineer", location: "Lagos", status: "open", removalReason: null, postedAt: new Date().toISOString(),
      applicationCount: 5, workType: null, employmentType: null, unlistedAt: null, adminReviewRequestedAt: null, adminReviewDecision: null, newApplicantCount: 2,
    };
    expect(renderToStaticMarkup(<PostedJobRow job={job} orgVerified={false} origin="https://talentrah.example" />)).not.toMatch(FIRST);
  });
});
