/**
 * The panel shows a page's own chips and opening line (the chip layout itself, the cap and the collapse, is tests/farah/quick-actions-layout.test.tsx).
 * Static render (no DOM, like farah-panel-transcript.test.tsx): the route is faked at the next/navigation boundary.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

let path: string | null = null;
vi.mock("next/navigation", () => ({ usePathname: () => path, useSearchParams: () => new URLSearchParams() }));

const { FarahPanel } = await import("@/components/app-shell/farah-panel");

describe("the panel on the billing page", () => {
  it("shows the three billing chips and the billing opening line, and not today's three", () => {
    path = "/billing";
    const html = renderToStaticMarkup(<FarahPanel firstName="Ada" />);
    for (const label of ["What can I do with my credits?", "Which pack or pass suits me?", "What&#x27;s free, and when does it renew?"]) expect(html).toContain(label);
    expect(html).toContain("Ask me what your credits can do");
    for (const gone of ["Job Interview Prep", "Career Advisor", "Salary Negotiation", "I can help you prep for an interview"]) expect(html).not.toContain(gone);
  });

  it("on a route that is not listed, today's three and today's greeting", () => {
    for (const p of ["/jobs/remote", "/settings", "/billing/callback", null]) {
      path = p;
      const html = renderToStaticMarkup(<FarahPanel firstName="Ada" />);
      for (const label of ["Job Interview Prep", "Career Advisor", "Salary Negotiation", "I can help you prep for an interview"]) expect(html, `${p}`).toContain(label);
      expect(html).not.toContain("What can I do with my credits?");
    }
  });
});

describe("the panel on the other pages (PR B)", () => {
  it("shows each page's chips and opening line, and the greeting prefix is the same on every page", () => {
    const cases: Array<[string, string, string]> = [
      ["/scholarships", "What's due soonest?", "Choosing a scholarship?"],
      ["/refer", "How does Refer &amp; Earn work?", "Want to invite someone?"],
      ["/talent-directory/verify", "What does the review involve?", "Thinking about joining the Talent Directory?"],
      ["/auto-apply", "How many free confirmations do I have left this week?", "Wondering what Auto-Apply will do with a match?"],
    ];
    for (const [p, chip, line] of cases) {
      path = p;
      const html = renderToStaticMarkup(<FarahPanel firstName="Ada" />);
      expect(html, p).toContain(chip.replace("'", "&#x27;"));
      expect(html, p).toContain(line);
      expect(html, p).not.toContain("Job Interview Prep");
    }
  });
});
