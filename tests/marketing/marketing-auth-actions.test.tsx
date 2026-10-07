/**
 * HWR-2: a signed-in visitor on an info page (how-we-review-resumes, the blog, the scholarship landings, /about, /contact...) saw "Log in" and "Get started for free", and both
 * bounced them straight back. With a session the masthead shows ONE "Go to your dashboard" link instead, and neither of the two auth buttons. The session is read client-side
 * after hydration (a cookie read: no server work, the static pages stay static), so the server render is always the signed-out one (byte-identity pinned in
 * marketing-masthead-signed-out-bytes.test.tsx). The destination is /dashboard, which picks the employer or seeker home on click (dashboard-destination.test.ts).
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MarketingAuthActions } from "@/components/marketing/marketing-auth-actions";

const render = (signedIn: boolean | null) =>
  renderToStaticMarkup(<MarketingAuthActions signedIn={signedIn} loginHref="/login?redirectTo=%2Fblog" signupHref="/signup?redirectTo=%2Fblog" />);

describe("the masthead's right-hand actions", () => {
  it("signed out, or not yet known: Log in and Get started for free, no dashboard link", () => {
    for (const state of [false, null]) {
      const html = render(state);
      expect(html).toContain(">Log in<");
      expect(html).toContain('aria-label="Get started for free"');
      expect(html).not.toContain("Go to your dashboard");
    }
  });
  it("signed in: ONE 'Go to your dashboard' link to /dashboard, and neither Log in nor Get started", () => {
    const html = render(true);
    expect(html).toContain("Go to your dashboard");
    expect([...html.matchAll(/<a /g)]).toHaveLength(1);
    expect(html).toMatch(/<a [^>]*href="\/dashboard"/);
    expect(html).not.toContain("Log in");
    expect(html).not.toContain("Get started");
  });
  it("the dashboard link is a 44px target like the buttons it replaces", () => {
    expect(render(true)).toContain("min-h-11");
  });
});
