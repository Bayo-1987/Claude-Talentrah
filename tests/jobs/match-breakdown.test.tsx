/**
 * MatchBreakdown (src/components/jobs/match-breakdown.tsx) — Stage 8's
 * display-only step. Renders the same `MatchExplanation` fitSummary/gapSkills
 * already read — no scoring change, no new computation.
 *
 * The ALX Africa case that motivated this: a job with exactly one screenable
 * skill tag ("project management"), fully matched, scored 100% · Excellent.
 * The point of this component is to make that thin denominator VISIBLE
 * rather than to change the number.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchBreakdown } from "@/components/jobs/match-breakdown";
import type { MatchExplanation } from "@/lib/matching/score";

const explanation = (over: Partial<MatchExplanation> = {}): MatchExplanation => ({
  matchedSkills: [],
  missingSkills: [],
  seniorityAlignment: "unknown",
  ...over,
});

function render(e: MatchExplanation) {
  return renderToStaticMarkup(<MatchBreakdown explanation={e} />);
}

describe("skill coverage", () => {
  it(
    "SABOTAGE-PROOF TARGET: the ALX Africa case — 1 of 1 tag, named as thin, not silently 100%",
    () => {
      const html = render(explanation({ matchedSkills: ["project management"], missingSkills: [] }));
      expect(html).toContain("1 of 1 tag");
      expect(html).toContain('only &quot;project management&quot; — thin');
    },
  );

  it("0 of 0 when no screenable tags exist at all", () => {
    const html = render(explanation());
    expect(html).toContain("0 of 0 tags");
    expect(html).toContain("no screenable skills listed");
  });

  it("names the thin case even when nothing matched", () => {
    const html = render(explanation({ matchedSkills: [], missingSkills: ["compliance"] }));
    expect(html).toContain("0 of 1 tag");
    expect(html).toContain("thin — none of the named skills matched");
  });

  it("drops the thin caption once there are enough tags to mean something", () => {
    const html = render(
      explanation({ matchedSkills: ["sql", "python"], missingSkills: ["aws"] }),
    );
    expect(html).toContain("2 of 3 tags");
    expect(html).not.toContain("thin");
  });
});

describe("seniority", () => {
  it("covers all four alignment values", () => {
    expect(render(explanation({ seniorityAlignment: "match" }))).toContain(">Match<");
    expect(render(explanation({ seniorityAlignment: "above" }))).toContain(">Above<");
    expect(render(explanation({ seniorityAlignment: "below" }))).toContain(">Below<");
    expect(render(explanation({ seniorityAlignment: "unknown" }))).toContain(">Not available<");
  });
});

describe("industry alignment", () => {
  it(
    "SABOTAGE-PROOF TARGET: renders as neutral text, never a match-tier color",
    () => {
      const html = render(explanation());
      expect(html).toContain("Not yet measured");
      // The three real tier colors — this is not a fourth tier, so none may
      // appear anywhere near this cell (the whole component has no tier
      // color at all).
      expect(html).not.toContain("text-green");
      expect(html).not.toContain("text-rust");
      expect(html).not.toContain("text-amber");
    },
  );
});
