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
  it("shows the three real alignment values", () => {
    expect(render(explanation({ seniorityAlignment: "match" }))).toContain(">Match<");
    expect(render(explanation({ seniorityAlignment: "above" }))).toContain(">Above<");
    expect(render(explanation({ seniorityAlignment: "below" }))).toContain(">Below<");
  });

  it("an UNKNOWN seniority renders no cell at all (not 'Not available'): a field shows only when it carries a real value", () => {
    const html = render(explanation({ seniorityAlignment: "unknown" }));
    expect(html).not.toContain("Seniority");
    expect(html).not.toContain("Not available");
  });
});

describe("no placeholder cells (S3-23a)", () => {
  it("SABOTAGE-PROOF TARGET: never renders 'Not yet measured' or 'flagged, not scored', or an Industry alignment cell", () => {
    for (const a of ["match", "above", "below", "unknown"] as const) {
      const html = render(explanation({ matchedSkills: ["sql"], missingSkills: ["aws", "docker"], seniorityAlignment: a }));
      expect(html).not.toContain("Not yet measured");
      expect(html).not.toContain("flagged, not scored");
      expect(html).not.toMatch(/industry alignment/i);
    }
  });

  it("renders exactly the cells that have real values: two when seniority is known, one when it is not", () => {
    const labels = (html: string) => (html.match(/uppercase">([^<]+)</g) ?? []).length;
    expect(labels(render(explanation({ matchedSkills: ["sql"], missingSkills: ["aws"], seniorityAlignment: "match" })))).toBe(2);
    expect(labels(render(explanation({ matchedSkills: ["sql"], missingSkills: ["aws"], seniorityAlignment: "unknown" })))).toBe(1);
  });

  it("uses no match-tier color anywhere (this component is not a fourth tier)", () => {
    const html = render(explanation({ matchedSkills: ["sql"], missingSkills: [], seniorityAlignment: "match" }));
    expect(html).not.toContain("text-green");
    expect(html).not.toContain("text-rust");
    expect(html).not.toContain("text-amber");
  });
});

describe("role fit (A2): 'Same family', 'Adjacent' or 'Different'; no cell when either side is unclassified", () => {
  it("renders exactly the three words", () => {
    expect(render(explanation({ roleFit: "same" }))).toContain(">Same family<");
    expect(render(explanation({ roleFit: "adjacent" }))).toContain(">Adjacent<");
    expect(render(explanation({ roleFit: "different" }))).toContain(">Different<");
    expect(render(explanation({ roleFit: "same" }))).toContain(">Role fit<");
  });

  it("is hidden for an unclassified side (roleFit 'unknown') and for a score computed without a title (no roleFit at all)", () => {
    expect(render(explanation({ roleFit: "unknown" }))).not.toContain("Role fit");
    expect(render(explanation())).not.toContain("Role fit");
  });

  it("never uses a match-tier color (it is not a fourth tier)", () => {
    for (const fit of ["same", "adjacent", "different"] as const) {
      const html = render(explanation({ roleFit: fit }));
      expect(html).not.toMatch(/text-(green|rust|amber)/);
    }
  });
});
