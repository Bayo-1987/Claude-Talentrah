/**
 * The merged filter control (finding 01).
 *
 * The applied filters used to be a loose row of chips. They are now segments
 * inside one 1.5px --ink container with hairline dividers — one instrument
 * rather than several floating parts.
 *
 * The boundary is the whole point of the change and is the thing most likely
 * to erode: only APPLIED filters go inside. The work-type, seniority and
 * skill rows underneath are browse affordances — they are how you pick a
 * filter, not a record of what is picked — and pulling any of them into the
 * container would turn a status display back into a form. The reference mock
 * showed exactly one applied skill chip inside, never the twelve-option list.
 *
 * Four properties are pinned:
 *
 *   1. Exactly one bordered container, and none when nothing is applied. An
 *      empty instrument is worse than no instrument.
 *   2. Removing one filter keeps the others and keeps the tab. A remove link
 *      that drops a sibling looks like the filter "not working".
 *   3. Every segment is a real hit target. The mock draws the x as a 9px
 *      glyph; 9px is a quarter of the minimum this project fixes, and a
 *      glyph-sized hit area is a bug already shipped here once.
 *   4. The browse rows stay outside the container.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FilterBar } from "@/components/jobs/filter-bar";

const FACET = [
  { skill: "sql", count: 38 },
  { skill: "tableau", count: 12 },
];

function render(props: Partial<Parameters<typeof FilterBar>[0]> = {}) {
  return renderToStaticMarkup(
    <FilterBar tab="recommended" skillFacet={FACET} {...props} />,
  );
}

const CONTAINER = 'class="flex flex-wrap items-stretch overflow-hidden border-[1.5px] border-ink"';

/**
 * The container's markup, tags balanced.
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

describe("one instrument, and only when there is something in it", () => {
  it("renders the one container even with no filter applied — the search field is in it", () => {
    /*
     * This assertion used to be the opposite: no filters, no container,
     * because an empty bordered box is a control with nothing in it. That
     * stopped being true when the search field moved inside — there is now
     * always something in it, so it always renders.
     *
     * The half that did NOT change, and is the point of the describe block, is
     * "exactly one". The first attempt at the search field shipped it as a
     * SECOND box with the same 1.5px border stacked above this one, which is
     * a scatter of two instruments wearing one instrument's clothes. The
     * count below is what caught that.
     */
    const html = render();
    expect(html.split(CONTAINER).length - 1).toBe(1);
    expect(mergedControl(html)).toContain('name="q"');
  });

  it("still offers no Clear filters when there is nothing to clear", () => {
    // The container is unconditional now; the clear action is not. Offering
    // it with nothing applied is a control that does nothing.
    expect(render()).not.toContain("Clear filters");
    expect(render({ workType: "remote" })).toContain("Clear filters");
  });

  it("renders exactly one container when filters are applied", () => {
    const html = render({ workType: "remote", seniority: "senior" });
    expect(html.split("border-[1.5px] border-ink").length - 1).toBe(1);
  });

  it("puts every applied filter inside it, and nothing else", () => {
    const inner = mergedControl(render({ workType: "remote", seniority: "senior", skill: "sql" }));
    expect(inner).toContain(">Remote<");
    expect(inner).toContain(">Senior<");
    expect(inner).toContain(">sql<");
  });

  it("keeps the divider off the trailing segment", () => {
    // `last:border-r-0` on the segments; the Clear link carries no border-r.
    const inner = mergedControl(render({ workType: "remote" }));
    const clear = inner.slice(inner.indexOf("Clear filters") - 400);
    expect(clear).not.toContain("border-r border-line");
  });
});

describe("removing one filter removes one filter", () => {
  const html = render({ workType: "remote", seniority: "senior", skill: "sql" });

  it("drops only its own key and keeps the siblings", () => {
    const inner = mergedControl(html);
    const href = (label: string) =>
      inner.match(new RegExp(`aria-label="Remove ${label} filter"[^>]*href="([^"]+)"`))?.[1] ?? "";

    expect(href("Remote")).toBe("/jobs?tab=recommended&amp;seniority=senior&amp;skill=sql");
    expect(href("Senior")).toBe("/jobs?tab=recommended&amp;workType=remote&amp;skill=sql");
    expect(href("sql")).toBe("/jobs?tab=recommended&amp;workType=remote&amp;seniority=senior");
  });

  it("never drops the tab — removing a filter must not throw you back to Recommended", () => {
    const inner = mergedControl(render({ tab: "saved", workType: "remote" }));
    expect(inner).toContain("/jobs?tab=saved");
  });

  it("clears all three at once from the trailing segment", () => {
    const inner = mergedControl(html);
    expect(inner).toContain('href="/jobs?tab=recommended">Clear filters');
  });

  describe("Stage 12: Clear filters and the country default", () => {
    it("does not add a country param when country was never applicable", () => {
      // Same render as `html` above — no country/countryApplicable passed —
      // Clear filters must stay exactly as it always has.
      expect(mergedControl(html)).toContain('href="/jobs?tab=recommended">Clear filters');
    });

    it(
      "SABOTAGE-PROOF TARGET: re-asserts country=all even when country is ALREADY " +
        "cleared (undefined) — otherwise clicking Clear filters after an explicit " +
        "clear would silently let the profile default reassert itself",
      () => {
        // This is exactly the state right after a user clicked the country
        // chip's own remove link: country is undefined, but it is undefined
        // BECAUSE it was cleared, not because it was never in play.
        const inner = mergedControl(
          render({ workType: "remote", country: undefined, countryApplicable: true }),
        );
        expect(inner).toContain("Clear filters");
        const clearHref = inner.match(/href="([^"]*)">Clear filters/)?.[1];
        expect(clearHref, "Clear filters link not found").toBeTruthy();
        expect(clearHref).toContain("country=all");
      },
    );

    it("the country chip itself is absent when country is cleared, applicable or not", () => {
      const inner = mergedControl(render({ country: undefined, countryApplicable: true }));
      expect(inner).not.toContain("Remove Nigeria filter");
    });
  });

  it("labels each remove link for screen readers", () => {
    for (const label of ["Remote", "Senior", "sql"]) {
      expect(html).toContain(`aria-label="Remove ${label} filter"`);
    }
  });
});

describe("segments are hit targets, not glyphs", () => {
  const inner = mergedControl(render({ workType: "remote", seniority: "senior", skill: "sql" }));

  it("gives every link in the control a 42px minimum height", () => {
    const links = inner.match(/<a [^>]*>/g) ?? [];
    expect(links.length).toBe(4); // three removes plus Clear filters
    for (const link of links) expect(link).toContain("min-h-[42px]");
  });

  it("suppresses the global link underline inside the instrument", () => {
    /*
     * globals.css sets `a { text-decoration: underline }` for the whole app.
     * Inherited here it turns the control back into a row of links that
     * happen to sit in a box — the underlines read as the segmentation
     * instead of the hairlines doing it. Caught in the browser, not in
     * markup review, which is why it is pinned.
     */
    for (const link of inner.match(/<a [^>]*>/g) ?? []) {
      expect(link).toContain("no-underline");
    }
  });

  it("marks the x decorative, because the link is the target", () => {
    // If the svg ever becomes the clickable element, this is 9x9.
    expect(inner).toContain('aria-hidden="true"');

    /*
     * There IS one button in the control now — the search field's submit — so
     * "no <button> anywhere" no longer says what it meant. What it meant is
     * that no remove affordance is a button, because each is a whole-segment
     * Link. Asserted directly: every button in the control is the search
     * submit, and every remove target is a Link carrying the aria-label.
     */
    const buttons = inner.match(/<button/g) ?? [];
    expect(buttons.length, "an unexpected button appeared in the filter control").toBe(1);
    expect(inner).toContain('type="submit"');
    expect(inner).toContain('aria-label="Remove Remote filter"');
  });
});

describe("the browse rows stay outside the instrument", () => {
  const html = render({ workType: "remote", skill: "sql" });
  const inner = mergedControl(html);

  it("keeps the twelve-option skill facet out of the container", () => {
    expect(html).toContain("Mentioned in the job text:");
    expect(inner).not.toContain("Mentioned in the job text:");
  });

  it("keeps the work-type and seniority pickers out of the container", () => {
    expect(html).toContain("Work type:");
    expect(html).toContain("Seniority:");
    expect(inner).not.toContain("Work type:");
    expect(inner).not.toContain("Seniority:");
  });

  it("does not swallow the facet's counts into the applied chip", () => {
    // The applied chip says "sql". The browse chip says "sql (38)". Mixing
    // them would claim the filter currently matches 38 jobs, which is the
    // pre-filter count.
    expect(inner).not.toContain("(38)");
    expect(html).toContain("(38)");
  });
});

describe("browse rows are hit targets too", () => {
  /*
   * A cheap tripwire, not the measurement. The real check is
   * `e2e/hit-targets.spec.ts`, which reads getBoundingClientRect in a
   * browser — and it exists because this exact assertion, written against
   * `min-h-10` alone, would have passed while "sql (38)" rendered 39.1px
   * wide. Both dimensions are named here for that reason.
   */
  const html = render({ workType: "remote", seniority: "senior" });
  const rowLinks = (label: string) => {
    const at = html.indexOf(`>${label}</span>`);
    const end = html.indexOf("</div>", at);
    return html.slice(at, end).match(/<a [^>]*>/g) ?? [];
  };

  it.each([
    ["Work type:", 3],
    ["Seniority:", 5],
    ["Mentioned in the job text:", 2],
  ])("%s links carry both dimensions", (label, expected) => {
    const links = rowLinks(label);
    expect(links.length).toBe(expected);
    for (const link of links) {
      expect(link).toContain("min-h-10");
      expect(link).toContain("min-w-10");
    }
  });
});
