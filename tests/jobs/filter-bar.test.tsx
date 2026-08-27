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
  it("renders no container at all when no filter is applied", () => {
    const html = render();
    expect(html).not.toContain("border-[1.5px] border-ink");
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
    expect(inner).not.toContain("<button");
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
