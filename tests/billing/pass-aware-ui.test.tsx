/**
 * Every credit-facing surface has to agree with what the entitlement layer
 * (src/lib/passes/entitlement.ts) actually decided — a covered user must
 * never be shown a credit price or balance for an action their Pass already
 * covers, because that reads as "your purchase did nothing" (the exact bug
 * a live account hit: the masthead pill said "0 credits · Top up" while a
 * tailoring run right next to it ran for free).
 *
 * These are pure component tests — no DB — because the coverage boolean
 * itself is already exhaustively tested against the real database in
 * tests/passes/entitlement.test.ts and tests/auto-apply/quota-pass-
 * awareness.test.ts. What matters here is strictly the last mile: given a
 * `passCovered`/`activePass` prop, does the component say the right thing.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ usePathname: () => "/jobs" }));

const { Masthead } = await import("@/components/app-shell/masthead");
const { FarahActions } = await import("@/components/scholarships/farah-actions");

describe("Masthead credits/pass pill", () => {
  const baseProps = { initials: "AB", email: "a@b.com", displayName: "Ada Bello" };

  it("with no active pass: shows the credit balance and Top up, as before", () => {
    const html = renderToStaticMarkup(
      <Masthead {...baseProps} creditsBalance={12} activePass={null} />,
    );
    expect(html).toContain("12 credits · Top up");
  });

  it(
    "with an active pass: shows the pass and days remaining, NEVER the credit balance/top-up pill " +
      "— a Pass holder must never be told their purchase did nothing",
    () => {
      const html = renderToStaticMarkup(
        <Masthead
          {...baseProps}
          creditsBalance={0}
          activePass={{ name: "30-Day Pass", daysRemaining: 12 }}
        />,
      );
      expect(html).toContain("30-Day Pass · 12d left");
      expect(html, "SABOTAGE-PROOF TARGET: the top-up pill must not survive an active pass").not.toContain(
        "Top up",
      );
      expect(html).not.toContain("0 credits");
    },
  );
});

describe("FarahActions (scholarship eligibility check + SOP draft buttons)", () => {
  const baseProps = { scholarshipId: "11111111-1111-1111-1111-111111111111" };

  it("uncovered user: sees the real credit price on every action, unchanged", () => {
    const html = renderToStaticMarkup(
      <FarahActions {...baseProps} creditsBalance={8} passCovered={false} />,
    );
    expect(html).toContain("Check my eligibility · 4 credits");
    expect(html).toContain("Draft my personal statement · 16 credits");
    expect(html).toContain("You have 8 credits");
  });

  it(
    "covered user: NEVER sees a credit price on a covered action " +
      "— SABOTAGE-PROOF TARGET",
    () => {
      const html = renderToStaticMarkup(
        <FarahActions {...baseProps} creditsBalance={0} passCovered={true} />,
      );
      expect(html).toContain("Check my eligibility · Included with your Pass");
      expect(html).toContain("Draft my personal statement · Included with your Pass");
      expect(html).toContain("Included with your Pass");
      expect(html).not.toContain("4 credits");
      expect(html).not.toContain("16 credits");
      expect(html).not.toContain("You have 0 credits");
    },
  );
});
