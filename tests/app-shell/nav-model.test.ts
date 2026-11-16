/**
 * NAV-DROPDOWN-REALIGN-1: the stepped bar (owner decision: Option B, first step about 1480).
 *
 *   >= 1536   all eight links in the bar, no "More"
 *   1480-1535 seven in the bar, "More" holds Feedback
 *   1280-1479 five in the bar, "More" holds Mentorship, Talent Directory, Feedback
 *   1024-1279 three in the bar, "More" holds the other five
 *   < 1024    no bar; the phone disclosure holds all eight
 *
 * The model owns the numbers and the literal class names (Tailwind only sees literals), and the masthead builds its classes from it, so a test of the model is a test of the markup's rule.
 */
import { describe, expect, it } from "vitest";
import {
  NAV_LINKS,
  NAV_BAR_MIN_PX,
  NAV_STEP_PX,
  barLinksAt,
  moreLinksAt,
  moreButtonShownAt,
  barClassFor,
  moreItemClassFor,
} from "@/components/app-shell/nav-model";

const hrefs = (links: readonly { href: string }[]) => links.map((l) => l.href);
const ALL = ["/jobs", "/tracker", "/auto-apply", "/resume-builder", "/scholarships", "/mentorship", "/talent-directory/verify", "/feedback"];

describe("the model", () => {
  it("lists the eight links in the owner's order, with no Refer a Friend", () => {
    expect(hrefs(NAV_LINKS)).toEqual(ALL);
    expect(NAV_LINKS.map((l) => l.label)).not.toContain("Refer a Friend");
  });
  it("names the step widths once: 1024 for the bar, then 1280, 1480, 1536", () => {
    expect(NAV_BAR_MIN_PX).toBe(1024);
    expect(NAV_STEP_PX).toEqual([1280, 1480, 1536]);
  });
});

describe("the stepped breakpoints", () => {
  const cases: Array<[number, number, number]> = [
    // width, links in the bar, links in More
    [1920, 8, 0],
    [1536, 8, 0],
    [1535, 7, 1],
    [1480, 7, 1],
    [1479, 5, 3],
    [1280, 5, 3],
    [1279, 3, 5],
    [1024, 3, 5],
    [1023, 0, 0],
    [390, 0, 0],
  ];
  it.each(cases)("at %ipx: %i in the bar, %i in More", (w, bar, more) => {
    expect(barLinksAt(w)).toHaveLength(bar);
    expect(moreLinksAt(w)).toHaveLength(more);
  });

  it("the bar and More together are always the full set, in order, with nothing twice (from 1024 up)", () => {
    for (let w = 1024; w <= 1920; w += 1) {
      const bar = hrefs(barLinksAt(w));
      const more = hrefs(moreLinksAt(w));
      expect([...bar, ...more], `at ${w}px`).toEqual(ALL);
    }
  });

  it("More is on screen exactly between 1024 and 1535", () => {
    expect(moreButtonShownAt(1023)).toBe(false);
    expect(moreButtonShownAt(1024)).toBe(true);
    expect(moreButtonShownAt(1535)).toBe(true);
    expect(moreButtonShownAt(1536)).toBe(false);
  });

  it("Jobs, Job Tracker and Auto-Apply never move into More", () => {
    for (const w of [1024, 1100, 1279, 1280, 1479, 1480, 1535, 1536]) {
      expect(hrefs(barLinksAt(w)).slice(0, 3), `at ${w}px`).toEqual(["/jobs", "/tracker", "/auto-apply"]);
    }
  });
});

describe("the literal classes agree with the rule", () => {
  it("each link's bar class turns it on at its own step and More's copy turns it off at the same step", () => {
    for (const link of NAV_LINKS) {
      const on = barClassFor(link);
      const off = moreItemClassFor(link);
      const from = Number(on.match(/min-\[(\d+)px\]:flex/)?.[1]);
      expect([1024, 1280, 1480, 1536], link.href).toContain(from);
      if (from === 1024) expect(off, link.href).toBe("hidden");
      else expect(off, link.href).toBe(`min-[${from}px]:hidden`);
      expect(on).toMatch(/^hidden /);
    }
  });
});
