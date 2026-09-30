/**
 * send-484 — the /tracker loading placeholder, for both visitors (see tests/jobs/feed-loading.test.tsx).
 *
 * Today's carries `<h1>Job Tracker</h1>` and the eyebrow "Every job, one place", both copied from the
 * signed-in page — so a streamed fallback puts a SECOND <h1> in the raw response next to the signed-out
 * landing page's own, and a signed-out visitor on a slow connection reads the signed-in heading first.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import TrackerLoading from "@/app/(app)/tracker/(list)/loading";
import { ROUTE_LOADING_TESTID } from "@/components/ui/skeleton";

describe("tracker loading.tsx", () => {
  const html = renderToStaticMarkup(<TrackerLoading />);

  it("still announces loading through the shared SkeletonStatus, with text the e2e waits on", () => {
    expect(html).toContain(`data-testid="${ROUTE_LOADING_TESTID}"`);
    expect(html).toContain('role="status"');
    expect(html).toContain("Loading the job tracker…");
  });

  it("keeps a 'Job Tracker' eyebrow and skeleton blocks", () => {
    expect(html).toContain(">Job Tracker<");
    expect(html).toMatch(/animate-pulse|skeleton/i);
  });

  it("carries no heading at all, so it can never add a second <h1> to the raw response", () => {
    expect(html).not.toMatch(/<h[1-6][\s>]/);
  });

  it("carries none of the signed-in page's copy", () => {
    expect(html).not.toContain("Every job, one place");
    expect(html).not.toContain("Loading your job tracker");
  });
});
