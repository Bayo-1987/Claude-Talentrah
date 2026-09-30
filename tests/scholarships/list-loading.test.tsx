/**
 * send-480 — the /scholarships loading placeholder must be correct for BOTH
 * visitors, because once the route is un-gated a signed-out visitor sees it too.
 *
 * MEASURED, not theorised: on production /mentorship (which has this exact
 * loading.tsx shape), a signed-out visitor on a throttled mobile profile sees the
 * SIGNED-IN heading first ("Talk to someone who's done it.", at 0.9 s on Fast 3G and
 * 1.5 s on Slow 3G) and then a different <h1> replaces it 0.1 to 0.3 s later. A
 * streamed loading fallback also lands in the RAW HTML, so a placeholder <h1> plus
 * the page's own <h1> is two <h1>s in the response a crawler reads.
 *
 * Today's placeholder carries the signed-in heading and the sentence "Browsing,
 * saving and tracking are free and unlimited", which scopes "free" wrongly for a
 * signed-out visitor (saving and tracking need an account).
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ScholarshipsListLoading from "@/app/(app)/scholarships/(list)/loading";
import { ROUTE_LOADING_TESTID } from "@/components/ui/skeleton";

describe("scholarships (list) loading.tsx", () => {
  const html = renderToStaticMarkup(<ScholarshipsListLoading />);

  it("still announces loading through the shared SkeletonStatus", () => {
    expect(html).toContain(`data-testid="${ROUTE_LOADING_TESTID}"`);
    expect(html).toContain('role="status"');
  });

  it("keeps the 'Scholarships' eyebrow and skeleton blocks", () => {
    expect(html).toContain("Scholarships");
    expect(html).toMatch(/animate-pulse|skeleton/i);
  });

  it("carries no heading at all, so it can never add a second <h1> to the raw response", () => {
    expect(html).not.toMatch(/<h1[\s>]/);
  });

  it("carries none of the signed-in-specific copy", () => {
    expect(html).not.toContain("Funding for your next degree");
    expect(html).not.toMatch(/saving and tracking/i);
    expect(html).not.toMatch(/free and unlimited/i);
  });
});
