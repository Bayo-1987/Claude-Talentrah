/**
 * send-480 — the landing page's section E links to /legal/terms#scholarship-listings, so the Terms
 * page's "Scholarship listings" heading needs that id. Rendered for real, so removing the id (or
 * renaming the heading) fails here instead of leaving a link that scrolls nowhere.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import TermsOfServicePage from "@/app/legal/terms/page";
import { ScholarshipsPublicLanding } from "@/components/scholarships/public-landing";

describe("Terms page anchor for the scholarship listings section", () => {
  const html = renderToStaticMarkup(<TermsOfServicePage />);

  it("renders the heading with id=\"scholarship-listings\"", () => {
    expect(html).toContain('<h2 id="scholarship-listings">Scholarship listings</h2>');
  });

  it("is the anchor the landing page links to (the route is /legal/terms)", () => {
    const landing = renderToStaticMarkup(<ScholarshipsPublicLanding facets={[]} listings={[]} />);
    expect(landing).toContain('href="/legal/terms#scholarship-listings"');
    expect(html.match(/id="scholarship-listings"/g)?.length, "the id must be unique on the page").toBe(1);
  });
});
