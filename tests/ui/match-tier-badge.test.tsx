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
import type { MatchExplanation } from "@/lib/matching/score";

const explanation = (over: Partial<MatchExplanation> = {}): MatchExplanation => ({
  matchedSkills: [],
  missingSkills: [],
  seniorityAlignment: "unknown",
  ...over,
});

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

describe("zero-screenable-skill postings (docs/zero-skill-scoring.md)", () => {
  it(
    "SABOTAGE-PROOF TARGET: a real zero-tag score (55, computeMatchScore's neutral-fallback ceiling) reads 'Unscreened', not a bare percentage",
    () => {
      const html = renderToStaticMarkup(<MatchTierBadge score={55} explanation={explanation()} />);
      expect(html).toContain("55% · Unscreened");
      // Still neutral, not a tier color — this is not a fourth tier.
      expect(html).toContain("text-ink-soft");
      expect(html).not.toContain("text-amber");
    },
  );

  it("does not fire on a real, if thin, PARTIAL match at the same score range — only a true zero denominator qualifies", () => {
    const html = renderToStaticMarkup(
      <MatchTierBadge score={35} explanation={explanation({ matchedSkills: [], missingSkills: ["react"] })} />,
    );
    expect(html).not.toContain("Unscreened");
    expect(html).toContain("35%");
  });

  it("renders 'Unscreened' in the display variant too", () => {
    const html = renderToStaticMarkup(
      <MatchTierBadge score={50} variant="display" explanation={explanation()} />,
    );
    expect(html).toContain("Unscreened");
  });

  it("no explanation supplied renders exactly as before — no qualifier appears without data to justify it", () => {
    const html = renderToStaticMarkup(<MatchTierBadge score={55} />);
    expect(html).not.toContain("Unscreened");
    expect(html).toContain("55%");
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

describe("thin screenable-tag denominator (One Acre Fund / ALX Africa case)", () => {
  it(
    "SABOTAGE-PROOF TARGET: exactly 1 screenable tag never renders an unqualified Excellent, even at 99%",
    () => {
      const html = renderToStaticMarkup(
        <MatchTierBadge
          score={99}
          explanation={explanation({ matchedSkills: ["project management"], missingSkills: [] })}
        />,
      );
      // The bare, unqualified label a founder actually saw live next to the
      // card's own "thin" sub-score line — must never render again.
      expect(html).not.toContain("99% · Excellent<");
      expect(html).not.toMatch(/99% · Excellent(?!\s*—)/);
      expect(html).toContain("thin");
      // Still the real tier and color — this qualifies the label, it does
      // not invent a fourth tier or drop the score.
      expect(html).toContain("99%");
      expect(html).toContain("text-green");
    },
  );

  it("0 screenable tags (thinner still) also qualifies the label", () => {
    const html = renderToStaticMarkup(
      <MatchTierBadge score={100} explanation={explanation()} />,
    );
    expect(html).not.toMatch(/100% · Excellent(?!\s*—)/);
    expect(html).toContain("thin");
  });

  it("2 screenable tags, both matched, still qualifies — same threshold as MatchBreakdown's own 'thin' cutoff", () => {
    const html = renderToStaticMarkup(
      <MatchTierBadge
        score={100}
        explanation={explanation({ matchedSkills: ["sql", "excel"], missingSkills: [] })}
      />,
    );
    expect(html).toContain("thin");
  });

  it("does NOT break the common case: a genuinely thick, well-matched skill set still renders plain Excellent", () => {
    const html = renderToStaticMarkup(
      <MatchTierBadge
        score={92}
        explanation={explanation({
          matchedSkills: ["sql", "python", "aws", "docker", "kubernetes"],
          missingSkills: ["react"],
        })}
      />,
    );
    expect(html).toContain("92% · Excellent");
    expect(html).not.toContain("thin");
  });

  it("no explanation supplied at all renders exactly as before (marketing demo / dev design-check callers)", () => {
    const html = renderToStaticMarkup(<MatchTierBadge score={92} />);
    expect(html).toContain("92% · Excellent");
    expect(html).not.toContain("thin");
  });

  it("a thin denominator on a non-Excellent tier is untouched — the contradiction is specific to Excellent", () => {
    const html = renderToStaticMarkup(
      <MatchTierBadge
        score={72}
        explanation={explanation({ matchedSkills: ["sql"], missingSkills: [] })}
      />,
    );
    expect(html).toContain("72% · Good");
    expect(html).not.toContain("thin");
  });

  it("renders the qualifier in the display variant too, alongside the tier word", () => {
    const html = renderToStaticMarkup(
      <MatchTierBadge
        score={99}
        variant="display"
        explanation={explanation({ matchedSkills: ["project management"], missingSkills: [] })}
      />,
    );
    expect(html).toContain("thin");
    expect(html).toContain("text-green");
  });
});

describe("showRawWhenCapped — the secondary raw-score marker", () => {
  it("SABOTAGE-PROOF TARGET: off by default — a capped score shows no marker and no second percentage", () => {
    const html = renderToStaticMarkup(<MatchTierBadge score={100} />);
    expect(html).toContain("99%");
    expect(html).not.toContain("100%");
    expect(html).not.toContain("title=");
  });

  it("with the flag on, a genuinely capped score (>99) gets a hover marker carrying the real value", () => {
    const html = renderToStaticMarkup(<MatchTierBadge score={100} showRawWhenCapped />);
    // "99% · Excellent" is still the only VISIBLE percentage — the "100%"
    // that legitimately appears is data inside the hover title, not a
    // second percentage competing with the face.
    expect(html).toContain("99% · Excellent");
    expect(html.replace(/title="[^"]*"/, "")).not.toContain("100%");
    expect(html).toContain('title="Uncapped match score: 100%"');
  });

  it("with the flag on, a score that was NOT capped (<=99) shows no marker at all", () => {
    const html = renderToStaticMarkup(<MatchTierBadge score={92} showRawWhenCapped />);
    expect(html).toContain("92% · Excellent");
    expect(html).not.toContain("title=");
  });

  it("does not touch displayMatchScore's own cap — the visible number is still 99, never 100+", () => {
    const html = renderToStaticMarkup(<MatchTierBadge score={137} showRawWhenCapped />);
    expect(html).toContain("99% · Excellent");
    expect(html.replace(/title="[^"]*"/, "")).not.toMatch(/13[0-9]%/);
    expect(html).toContain('title="Uncapped match score: 137%"');
  });
});
