/**
 * The Auto-Apply proof-of-work digest email — pure function, no DB, same
 * shape as tests/digest/template.test.ts.
 *
 * ── THE HONESTY RULE, PINNED ────────────────────────────────────────────────
 *
 * A digest that only ever reports good news reads as marketing. Both the
 * "clean week" and "mixed week" cases below assert the ACTUAL copy appears,
 * not just that the function returns something.
 */
import { describe, expect, it } from "vitest";
import { buildAutoApplyDigestEmail } from "@/lib/auto-apply-digest/template";
import type { AutoApplyDigestSummary } from "@/lib/auto-apply-digest/select";

const summary = (over: Partial<AutoApplyDigestSummary> = {}): AutoApplyDigestSummary => ({
  queued: 4,
  submitted: 3,
  handedOff: 1,
  dismissed: 0,
  expired: 0,
  highlights: [
    { jobTitle: "Backend Engineer", companyName: "Zaria Digital", tier: "Excellent" },
    { jobTitle: "Data Analyst", companyName: "Moniepoint", tier: "Excellent" },
  ],
  ...over,
});

describe("a clean week — all resolved, nothing dismissed or expired", () => {
  it("reports the queued count and the approved/handed-off breakdown", () => {
    const { text, html } = buildAutoApplyDigestEmail(summary(), "Ada");
    expect(text).toContain("Farah queued 4 applications for your review this week.");
    expect(text).toContain("You approved 3, and Farah handed 1 off to apply directly.");
    expect(html).toContain("Farah queued 4 applications for your review this week.");
  });

  it("says nothing about dismissed/expired when there were none", () => {
    const { text } = buildAutoApplyDigestEmail(summary(), "Ada");
    expect(text.toLowerCase()).not.toContain("didn't make the cut");
    expect(text.toLowerCase()).not.toContain("expired before");
  });

  it("lists the highlights with their job, company, and tier", () => {
    const { text, html } = buildAutoApplyDigestEmail(summary(), "Ada");
    expect(text).toContain("Excellent — Backend Engineer, Zaria Digital");
    expect(html).toContain("Backend Engineer");
    expect(html).toContain("Zaria Digital");
  });
});

describe("a mixed week — the honesty lines", () => {
  it("states a dismissal plainly, singular", () => {
    const { text } = buildAutoApplyDigestEmail(
      summary({ queued: 5, submitted: 3, handedOff: 0, dismissed: 1, expired: 0, highlights: [] }),
      "Ada",
    );
    expect(text).toContain("1 didn't make the cut when you reviewed it.");
  });

  it("states dismissals plainly, plural", () => {
    const { text } = buildAutoApplyDigestEmail(
      summary({ queued: 6, submitted: 2, handedOff: 0, dismissed: 3, expired: 0, highlights: [] }),
      "Ada",
    );
    expect(text).toContain("3 didn't make the cut when you reviewed them.");
  });

  it("states an expiry plainly", () => {
    const { text } = buildAutoApplyDigestEmail(
      summary({ queued: 3, submitted: 1, handedOff: 0, dismissed: 0, expired: 1, highlights: [] }),
      "Ada",
    );
    expect(text).toContain("1 expired before you got to it.");
  });

  it("mentions dismissed AND expired together when both happened the same week", () => {
    const { text } = buildAutoApplyDigestEmail(
      summary({ queued: 4, submitted: 1, handedOff: 0, dismissed: 1, expired: 1, highlights: [] }),
      "Ada",
    );
    expect(text).toContain("1 didn't make the cut when you reviewed it.");
    expect(text).toContain("1 expired before you got to it.");
  });

  it("mentions how many are still waiting on review when the counts don't add up to the total queued", () => {
    const { text } = buildAutoApplyDigestEmail(
      summary({ queued: 5, submitted: 2, handedOff: 0, dismissed: 0, expired: 0, highlights: [] }),
      "Ada",
    );
    expect(text).toContain("3 are still waiting on your review.");
  });

  it("omits the approved/handed-off sentence when neither happened yet", () => {
    const { text } = buildAutoApplyDigestEmail(
      summary({ queued: 2, submitted: 0, handedOff: 0, dismissed: 0, expired: 0, highlights: [] }),
      "Ada",
    );
    expect(text).not.toContain("You approved");
    expect(text).not.toContain("handed");
  });
});

describe("voice and format", () => {
  it("signs off as Farah, and never calls her the AI or a bot", () => {
    const { text } = buildAutoApplyDigestEmail(summary(), "Ada");
    expect(text).toContain("— Farah");
    for (const banned of ["the AI", "the bot", "chatbot"]) {
      expect(text.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });

  it("greets without a name rather than printing an empty one", () => {
    const { text } = buildAutoApplyDigestEmail(summary(), null);
    expect(text).toContain("Hi,");
    expect(text).not.toMatch(/Hi (null|undefined)/);
  });

  it("links to the in-app queue, absolutely", () => {
    const { text, html } = buildAutoApplyDigestEmail(summary(), "Ada");
    expect(text).toMatch(/https?:\/\/\S+\/auto-apply/);
    expect(html).toMatch(/href="https?:\/\/[^"]*\/auto-apply"/);
  });

  it("always ships a plain-text part alongside the HTML — low-end-Android/expensive-data market", () => {
    const { text, html } = buildAutoApplyDigestEmail(summary(), "Ada");
    expect(text.length).toBeGreaterThan(60);
    expect(html).toContain("<html>");
  });

  it("uses singular 'application' for exactly 1 queued", () => {
    const { text, subject } = buildAutoApplyDigestEmail(
      summary({ queued: 1, submitted: 0, handedOff: 0, dismissed: 0, expired: 0, highlights: [] }),
      "Ada",
    );
    expect(text).toContain("Farah queued 1 application for your review this week.");
    expect(subject).toContain("1 application this week");
  });
});

describe("escaping", () => {
  it("neutralises markup in a highlight's job title or company name", () => {
    const { html } = buildAutoApplyDigestEmail(
      summary({
        highlights: [
          { jobTitle: "<script>alert(1)</script>", companyName: '"><img src=x onerror=alert(1)>', tier: "Excellent" },
        ],
      }),
      "Ada",
    );
    expect(html, "raw script tag reached the email body").not.toContain("<script>");
    expect(html, "an injected <img> became a real element").not.toMatch(/<img\b/i);
    expect(html).toContain("&lt;script&gt;");
  });
});
