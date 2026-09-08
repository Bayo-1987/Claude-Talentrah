/**
 * Path 3 (0118/0119): the employer-side states on Jobs Posted, rendered
 * directly rather than assumed from the Server Action alone — a correct
 * `requestJobReviewAction` wired to a button nobody renders, or a badge that
 * silently reverts once a decision exists, would both pass every RLS test
 * and still ship a broken screen.
 *
 * `PostedJobRow` is a Server Component with no client state, so
 * `renderToStaticMarkup` is enough — same approach as
 * tests/employer/job-share-button.test.tsx next door.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PostedJobRow, type PostedJob } from "@/components/employer/posted-job-row";

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

function render(job: Partial<PostedJob>) {
  return renderToStaticMarkup(
    <PostedJobRow job={{ ...BASE, ...job }} orgVerified={false} origin="https://talentrah.example" />,
  );
}

describe("Path 3 — nothing requested yet", () => {
  it("offers the Submit for review button", () => {
    const html = render({});
    expect(html).toContain("Submit for review");
  });

  it("shows no Path 3 badge", () => {
    const html = render({});
    expect(html).not.toContain("Pending review");
    expect(html).not.toContain("Approved for the feed");
    expect(html).not.toContain("Review: not approved");
  });
});

describe("Path 3 — requested, not yet decided", () => {
  const job = { adminReviewRequestedAt: new Date().toISOString() };

  it("shows Pending review instead of the button", () => {
    const html = render(job);
    expect(html).toContain("Pending review");
    expect(html).not.toContain("Submit for review");
  });
});

describe("Path 3 — approved", () => {
  const job = {
    adminReviewRequestedAt: new Date().toISOString(),
    adminReviewDecision: "approved",
  };

  it("shows the approved badge and not the button or the pending state", () => {
    const html = render(job);
    expect(html).toContain("Approved for the feed");
    expect(html).not.toContain("Submit for review");
    expect(html).not.toContain("Pending review");
  });
});

describe("Path 3 — rejected", () => {
  const job = {
    adminReviewRequestedAt: new Date().toISOString(),
    adminReviewDecision: "rejected",
  };

  it("reflects the outcome honestly rather than silently offering the button again", () => {
    const html = render(job);
    expect(html).toContain("Review: not approved");
    // The whole point of the honesty requirement: a decided posting must not
    // look like an undecided one just because it was refused.
    expect(html).not.toContain("Submit for review");
    expect(html).not.toContain("Pending review");
  });
});

describe("Path 3 — an already-verified organisation", () => {
  it("shows none of the Path 3 UI at all", () => {
    const html = renderToStaticMarkup(
      <PostedJobRow
        job={{ ...BASE, adminReviewRequestedAt: new Date().toISOString() }}
        orgVerified={true}
        origin="https://talentrah.example"
      />,
    );
    // A verified org's postings are already public — Path 3 has nothing to
    // add, and showing its UI here would just be confusing.
    expect(html).not.toContain("Submit for review");
    expect(html).not.toContain("Pending review");
  });
});
