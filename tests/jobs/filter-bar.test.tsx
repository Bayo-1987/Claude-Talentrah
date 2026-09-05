/**
 * The jobs feed's filter controls (Part 3 of the filter-row redesign).
 *
 * The applied-filter CHIP ROW is gone — work type, seniority, posted and
 * country now show their own state directly (a rust link, a menu button's
 * own face), so a second, redundant list of "what's applied" no longer
 * exists. What's pinned here instead:
 *
 *   1. The search instrument still renders as exactly one bordered box, with
 *      "Clear filters" the one thing left inside it with no other display.
 *   2. Work type and seniority are MULTI-select: two can be active, and
 *      clicking an active one clears only that one, keeping the other.
 *   3. Country, posted stay single-value, and country's own "+ Remote"
 *      framing from the old chip does not need to exist anywhere anymore —
 *      the honest caveat about that lives in jobs/page.tsx's own prose, not
 *      this component.
 *   4. Nothing named Skills survives: no facet prop, no disclosure, no
 *      ?skill= handling.
 *   5. Every control is a real hit target.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FilterBar } from "@/components/jobs/filter-bar";

function render(props: Partial<Parameters<typeof FilterBar>[0]> = {}) {
  return renderToStaticMarkup(<FilterBar tab="recommended" {...props} />);
}

const CONTAINER = 'class="flex flex-wrap items-stretch overflow-hidden border-[1.5px] border-ink"';

/**
 * The search instrument's markup, tags balanced.
 *
 * Deliberately not a `.slice()` to the next `</div>`: that happens to work
 * only while the container holds no nested div, so it would keep passing
 * while quietly measuring the wrong region the moment one is added.
 */
function mergedControl(html: string): string {
  const start = html.indexOf(CONTAINER);
  if (start === -1) return "";
  let i = html.indexOf(">", start) + 1;
  let depth = 1;
  const from = i;
  while (depth > 0 && i < html.length) {
    const open = html.indexOf("<div", i);
    const close = html.indexOf("</div>", i);
    if (close === -1) break;
    if (open !== -1 && open < close) {
      depth++;
      i = open + 4;
    } else {
      depth--;
      if (depth === 0) return html.slice(from, close);
      i = close + 6;
    }
  }
  return html.slice(from);
}

describe("the search instrument", () => {
  it("renders exactly one container, with or without filters applied", () => {
    expect(render().split(CONTAINER).length - 1).toBe(1);
    expect(render({ workTypes: ["remote"] }).split(CONTAINER).length - 1).toBe(1);
    expect(mergedControl(render())).toContain('name="q"');
  });

  it("offers Clear filters only when something is applied", () => {
    expect(render()).not.toContain("Clear filters");
    expect(render({ workTypes: ["remote"] })).toContain("Clear filters");
    expect(render({ seniorities: ["senior"] })).toContain("Clear filters");
    expect(render({ posted: "week" })).toContain("Clear filters");
    expect(render({ q: "python" })).toContain("Clear filters");
  });

  it("Clear filters drops every dimension at once, keeping the tab", () => {
    const inner = mergedControl(
      render({ tab: "saved", workTypes: ["remote"], seniorities: ["senior"], q: "python" }),
    );
    expect(inner).toContain('href="/jobs?tab=saved">Clear filters');
  });

  describe("Stage 12: Clear filters and the country default", () => {
    it("does not add a country param when country was never applicable", () => {
      const inner = mergedControl(render({ workTypes: ["remote"] }));
      expect(inner).toContain('href="/jobs?tab=recommended">Clear filters');
    });

    it(
      "SABOTAGE-PROOF TARGET: re-asserts country=all even when country is ALREADY " +
        "cleared (undefined) — otherwise clicking Clear filters after an explicit " +
        "clear would silently let the profile default reassert itself",
      () => {
        const inner = mergedControl(
          render({ workTypes: ["remote"], country: undefined, countryApplicable: true }),
        );
        expect(inner).toContain("Clear filters");
        const clearHref = inner.match(/href="([^"]*)">Clear filters/)?.[1];
        expect(clearHref, "Clear filters link not found").toBeTruthy();
        expect(clearHref).toContain("country=all");
      },
    );
  });

  it("carries every other filter through the hidden inputs when searching", () => {
    const inner = mergedControl(
      render({ workTypes: ["remote", "hybrid"], seniorities: ["senior"], posted: "week", country: "Ghana" }),
    );
    expect(inner).toContain('name="workType" value="remote,hybrid"');
    expect(inner).toContain('name="seniority" value="senior"');
    expect(inner).toContain('name="posted" value="week"');
    expect(inner).toContain('name="country" value="Ghana"');
  });
});

describe("Skills is gone", () => {
  it("renders nothing named Skills anywhere", () => {
    // <details> itself is now legitimately used by the Country / mobile
    // Work type / Seniority / Posted menus (filter-menu.tsx) — what's pinned
    // here is that no CONTENT mentions Skills, not that <details> is absent.
    const html = render({ workTypes: ["remote"] });
    expect(html).not.toContain("Skills");
    expect(html).not.toContain("(38)");
  });
});

describe("work type and seniority are multi-select", () => {
  it("shows two active links at once", () => {
    const html = render({ workTypes: ["remote", "hybrid"] });
    // The desktop row's active class, on both.
    const activeCount = (html.match(/font-semibold text-rust/g) ?? []).length;
    expect(activeCount).toBeGreaterThanOrEqual(2);
  });

  it("clicking an active value's link keeps the sibling and drops only itself", () => {
    const html = render({ workTypes: ["remote", "hybrid"] });
    // The Remote link, with both currently active, must toggle to just hybrid.
    expect(html).toContain("workType=hybrid");
  });

  it("clicking an inactive value's link adds it to what's already selected", () => {
    const html = render({ workTypes: ["remote"] });
    // The Hybrid link, with only remote active, must toggle to both.
    expect(html).toContain("workType=remote%2Chybrid");
  });

  it("seniority behaves the same way", () => {
    // Both active: clicking Senior drops just Senior, keeping Lead.
    expect(render({ seniorities: ["senior", "lead"] })).toContain("seniority=lead");
    // Only Senior active: clicking Lead adds it, keeping Senior.
    expect(render({ seniorities: ["senior"] })).toContain("seniority=senior%2Clead");
  });
});

describe("country and posted stay single-value", () => {
  it("choosing a country never appends to a list — it's always exactly one value", () => {
    const html = render({ country: "Nigeria" });
    expect(html).not.toMatch(/country=Nigeria%2C/);
    expect(html).not.toMatch(/country=Nigeria,/);
  });

  it("the country button's face shows the live value", () => {
    expect(render({ country: "Ghana" })).toContain(">Ghana<");
    expect(render()).toContain("Every country");
  });

  it("posted toggles off rather than accumulating", () => {
    const html = render({ posted: "week" });
    // Clicking the already-active "Past week" link must clear it — href with
    // no posted param at all, immediately followed by that link's own text.
    expect(html).toMatch(/href="\/jobs\?tab=recommended">Past week/);
  });
});

describe("hit targets", () => {
  it("gives the desktop browse links a real 40x40 minimum", () => {
    const html = render({ workTypes: ["remote"] });
    const links = html.match(/<a [^>]*>(?:Remote|Hybrid|Onsite|Entry|Senior)<\/a>/g) ?? [];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toContain("min-h-10");
      expect(link).toContain("min-w-10");
    }
  });

  it("gives the country menu button and its rows a real 40px height", () => {
    const html = render({ country: "Nigeria" });
    expect(html).toContain("min-h-10");
    const summary = html.match(/<summary[^>]*>/)?.[0] ?? "";
    expect(summary).toContain("min-h-10");
  });
});
