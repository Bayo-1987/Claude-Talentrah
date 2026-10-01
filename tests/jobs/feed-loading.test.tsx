/**
 * send-484 — the /jobs loading placeholder must be correct for BOTH visitors, because once the
 * route is un-gated a signed-out visitor sees it too (send-480's /scholarships loading test, same
 * reasoning, same shape).
 *
 * Today's placeholder is signed-in chrome: a tab row shaped like Recommended/External/Most Recent/Saved,
 * an Auto-Apply toggle block, a filter bar, "Today's board" and "Loading your jobs feed…". A streamed
 * fallback lands in the RAW HTML next to the page, so none of that may be there for a signed-out
 * visitor, and it may not carry a heading at all (a placeholder <h1> plus the page's own is two <h1>s
 * in the response a crawler reads).
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import JobsFeedLoading from "@/app/(app)/jobs/(feed)/loading";
import { ROUTE_LOADING_TESTID } from "@/components/ui/skeleton";

describe("jobs (feed) loading.tsx", () => {
  const html = renderToStaticMarkup(<JobsFeedLoading />);

  it("still announces loading through the shared SkeletonStatus, with text the e2e waits on", () => {
    expect(html).toContain(`data-testid="${ROUTE_LOADING_TESTID}"`);
    expect(html).toContain('role="status"');
    expect(html).toContain("Loading jobs…");
  });

  it("keeps a 'Jobs' eyebrow and skeleton blocks", () => {
    expect(html).toContain(">Jobs<");
    expect(html).toMatch(/animate-pulse|skeleton/i);
  });

  it("carries no heading at all, so it can never add a second <h1> to the raw response", () => {
    expect(html).not.toMatch(/<h[1-6][\s>]/);
  });

  it("carries none of the signed-in-specific copy", () => {
    expect(html).not.toContain("Loading your jobs feed");
    expect(html).not.toContain("Today&#x27;s board");
    expect(html).not.toContain("Today's board");
  });

  it("does not sketch signed-in chrome: no tab row, no Auto-Apply toggle block", () => {
    // The old placeholder drew a 4-tab row (border-b-[2.5px]) and a 72px-high toggle block.
    expect(html).not.toContain("border-b-[2.5px]");
    expect(html).not.toContain("h-[72px]");
  });
});
