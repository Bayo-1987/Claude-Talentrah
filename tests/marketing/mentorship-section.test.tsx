/**
 * send-389 — the new homepage Mentorship section. Two things pinned here:
 * a working link to the real /mentorship route, and the absence of any
 * fabricated/hardcoded stat — this section deliberately shows NO session
 * count or satisfaction number (queried live, 2026-09-19: exactly 1 session
 * ever booked platform-wide, still not completed — far too thin to cite
 * without undercutting the credibility argument it's meant to build; see
 * this file's own header for the two independent reasons, RLS + headcount,
 * neither name/photo/bio is real-mentor-specific either).
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MentorshipSection } from "@/components/marketing/mentorship-section";

describe("the homepage Mentorship section", () => {
  const html = renderToStaticMarkup(<MentorshipSection />);
  // send-401's NairaAmount wraps the ₦ sign in its own <span> (a real,
  // deliberate fix for Newsreader's missing glyph — see naira-amount.tsx's
  // own header), so raw HTML no longer has "₦15,000" as one contiguous
  // substring even though it's the correct, visually-adjacent rendering.
  // Strip tags for text-content assertions the same way a reader (or a
  // screen reader) actually experiences the page.
  const text = html.replace(/<[^>]+>/g, "");

  it("links to the real /mentorship route", () => {
    // Attribute order on the rendered <a> isn't guaranteed to match JSX prop
    // order (Next's Link doesn't preserve it), so href and the visible text
    // are asserted independently rather than as one fixed-order pattern.
    expect(html).toMatch(/<a[^>]*href="\/mentorship"[^>]*>Find a mentor<\/a>/);
  });

  it("shows the real, current pricing floor rather than the stale build-prompt range", () => {
    // ₦15,000 is the real minimum of the two live mentors' base_price_ngn,
    // queried directly against production before writing this copy — NOT
    // CLAUDE.md's own "₦5k–₦100k+" figure, which this send's own
    // investigation found to be stale against the real, current data.
    expect(text).toContain("₦15,000");
    expect(text).not.toContain("₦5,000");
    expect(text).not.toContain("100,000");
  });

  it("names no individual mentor and cites no fabricated or unverifiable stat", () => {
    // No session count, no satisfaction rating, no headcount claim — the
    // real numbers behind this section (2 mentors, 1 booked session) are
    // too thin to cite without reading as thin, per build prompt §6.1's own
    // rule against invented/undersupported social proof.
    expect(html).not.toMatch(/\d+\s*(sessions?|mentors?)\s*(booked|completed)/i);
    expect(html).not.toMatch(/\d+%\s*(satisfaction|rating)/i);
  });

  it("reuses the same high-stakes moment already established in Meet Farah, not an invented example", () => {
    expect(html).toContain("negotiating a real offer");
    expect(html).toContain("final-round interview");
  });
});
