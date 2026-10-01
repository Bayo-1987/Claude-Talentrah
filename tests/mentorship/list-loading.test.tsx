/**
 * send-487 — the /mentorship loading placeholder must be correct for BOTH visitors: a signed-out visitor
 * reaches this route too (send-385), and the placeholder was written for the signed-in page only. Same
 * pattern as /scholarships (send-480, tests/scholarships/list-loading.test.tsx), /jobs and /tracker (send-484).
 *
 * MEASURED, not theorised (send-480, on this very route): on a throttled mobile profile a signed-out visitor
 * sees the SIGNED-IN heading ("Talk to someone who's done it.") first (0.9 s on Fast 3G, 1.5 s on Slow 3G),
 * then a different <h1> replaces it. A streamed loading fallback also lands in the RAW HTML next to the page,
 * so a placeholder <h1> plus the page's own is two <h1>s in the response a crawler reads.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MentorshipListLoading from "@/app/(app)/mentorship/(list)/loading";
import { ROUTE_LOADING_TESTID } from "@/components/ui/skeleton";

describe("mentorship (list) loading.tsx", () => {
  const html = renderToStaticMarkup(<MentorshipListLoading />);

  it("still announces loading through the shared SkeletonStatus", () => {
    expect(html).toContain(`data-testid="${ROUTE_LOADING_TESTID}"`);
    expect(html).toContain('role="status"');
    expect(html).toContain("Loading mentors…");
  });

  it("keeps the 'Mentorship' eyebrow and the skeleton cards", () => {
    expect(html).toContain(">Mentorship<");
    expect(html).toMatch(/animate-pulse|skeleton/i);
  });

  it("carries no heading at all, so it can never add a second <h1> to the raw response", () => {
    expect(html).not.toMatch(/<h[1-6][\s>]/);
  });

  it("carries none of the signed-in page's copy", () => {
    expect(html).not.toContain("done it");
    expect(html).not.toMatch(/Farah can benchmark/i);
    expect(html).not.toMatch(/human mentor is for the moments/i);
    expect(html).not.toMatch(/second opinion on your resume/i);
  });

  it("is not vacuous: the signed-in page's own heading text is exactly what the old placeholder carried", async () => {
    // Control. page.tsx still renders this heading for a signed-in visitor; the placeholder must not echo it.
    const page = await import("node:fs").then((fs) =>
      fs.readFileSync("src/app/(app)/mentorship/(list)/page.tsx", "utf8"),
    );
    expect(page).toContain("Talk to someone who&apos;s done it.");
  });
});
