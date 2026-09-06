/**
 * Sabotage-proof: an "unreachable" job must never leak its /jobs/[id] URL
 * through any rendering path, in either component — not behind a closed
 * popover, not as a disabled-but-present link, not anywhere in the markup.
 *
 * The "public" positive case for EmployerJobShareButton (does the popover,
 * once opened, contain the right link and the right share targets) needs
 * real interactivity and is covered in e2e instead — see
 * e2e/employer-share.spec.ts, which also proves the link it produces
 * actually renders for a signed-out visitor, not just that the string looks
 * right.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EmployerJobShareButton, EmployerJobShareInline } from "@/components/employer/job-share-button";

const ORIGIN = "https://talentrah.example";
const JOB_ID = "11111111-1111-1111-1111-111111111111";
const URL_FRAGMENT = `/jobs/${JOB_ID}`;

describe("EmployerJobShareButton — unreachable visibility", () => {
  it("never renders the job's URL anywhere in the markup", () => {
    const html = renderToStaticMarkup(
      <EmployerJobShareButton
        jobId={JOB_ID}
        jobTitle="Backend Engineer"
        origin={ORIGIN}
        visibility="unreachable"
      />,
    );
    expect(html).not.toContain(URL_FRAGMENT);
    expect(html).not.toContain(ORIGIN);
  });

  it("renders an explanatory link instead of a share action", () => {
    const html = renderToStaticMarkup(
      <EmployerJobShareButton
        jobId={JOB_ID}
        jobTitle="Backend Engineer"
        origin={ORIGIN}
        visibility="unreachable"
      />,
    );
    expect(html).toContain("Unlock sharing");
    expect(html).toContain('href="/employer/profile"');
  });
});

describe("EmployerJobShareButton — public visibility", () => {
  it("renders a Share trigger, closed by default (no link exposed before a click)", () => {
    const html = renderToStaticMarkup(
      <EmployerJobShareButton
        jobId={JOB_ID}
        jobTitle="Backend Engineer"
        origin={ORIGIN}
        visibility="public"
      />,
    );
    expect(html).toContain("Share");
    // The popover only mounts once `open` is true — closed by default, so
    // the URL should not appear in the initial server-rendered markup either.
    // (This is a rendering detail, not the sabotage-proof guarantee above —
    // "public" is allowed to expose the link once opened, just not before.)
    expect(html).not.toContain(URL_FRAGMENT);
  });
});

describe("EmployerJobShareInline — unreachable visibility", () => {
  it("never renders the job's URL anywhere in the markup", () => {
    const html = renderToStaticMarkup(
      <EmployerJobShareInline
        jobId={JOB_ID}
        jobTitle="Backend Engineer"
        origin={ORIGIN}
        visibility="unreachable"
      />,
    );
    expect(html).not.toContain(URL_FRAGMENT);
    expect(html).not.toContain(ORIGIN);
    expect(html).toContain("verify your company");
  });
});

describe("EmployerJobShareInline — public visibility", () => {
  it("renders the correct absolute URL up front, no click required", () => {
    const html = renderToStaticMarkup(
      <EmployerJobShareInline
        jobId={JOB_ID}
        jobTitle="Backend Engineer"
        origin={ORIGIN}
        visibility="public"
      />,
    );
    expect(html).toContain(`${ORIGIN}${URL_FRAGMENT}`);
  });

  it("includes a LinkedIn share target, per the brief (WhatsApp/LinkedIn/X)", () => {
    const html = renderToStaticMarkup(
      <EmployerJobShareInline
        jobId={JOB_ID}
        jobTitle="Backend Engineer"
        origin={ORIGIN}
        visibility="public"
      />,
    );
    expect(html).toContain("linkedin.com/sharing/share-offsite");
    expect(html).toContain("wa.me");
  });
});
