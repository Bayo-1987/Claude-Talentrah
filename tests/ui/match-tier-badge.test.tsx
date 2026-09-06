/**
 * MatchTierBadge (src/components/ui/match-tier-badge.tsx) — a sub-60 score
 * renders no tier word and no tier color, never a fourth colored label.
 *
 * A 50% card used to read "Fair" — the same tier word and amber color as a
 * 69% — because `getMatchTier` has no floor by design (it feeds
 * `match_scores.tier`, a NOT NULL column, and can't safely return "nothing").
 * `getDisplayMatchTier` adds the floor for display only; this file pins that
 * the badge actually uses it.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchTierBadge } from "@/components/ui/match-tier-badge";

describe("a sub-60 score", () => {
  it("SABOTAGE-PROOF TARGET: renders no tier word at all (eyebrow variant)", () => {
    const html = renderToStaticMarkup(<MatchTierBadge score={50} />);
    expect(html).not.toContain("Fair");
    expect(html).not.toContain("Good");
    expect(html).not.toContain("Excellent");
    expect(html).toContain("50%");
    expect(html).not.toContain("·");
  });

  it("renders in neutral ink-soft, not a tier color", () => {
    const html = renderToStaticMarkup(<MatchTierBadge score={50} />);
    expect(html).toContain("text-ink-soft");
    expect(html).not.toContain("text-amber");
    expect(html).not.toContain("text-rust");
    expect(html).not.toContain("text-green");
  });

  it("renders no tier word in the display variant either", () => {
    const html = renderToStaticMarkup(<MatchTierBadge score={0} variant="display" />);
    expect(html).not.toContain("Fair");
    expect(html).toContain("0");
    expect(html).not.toContain("text-amber");
  });
});

describe("60 and above still shows its tier, exactly as before", () => {
  it("60-69 is Fair", () => {
    const html = renderToStaticMarkup(<MatchTierBadge score={63} />);
    expect(html).toContain("63% · Fair");
    expect(html).toContain("text-amber");
  });

  it("70-79 is Good", () => {
    const html = renderToStaticMarkup(<MatchTierBadge score={72} />);
    expect(html).toContain("72% · Good");
    expect(html).toContain("text-rust");
  });

  it("80+ is Excellent", () => {
    const html = renderToStaticMarkup(<MatchTierBadge score={92} />);
    expect(html).toContain("92% · Excellent");
    expect(html).toContain("text-green");
  });
});
