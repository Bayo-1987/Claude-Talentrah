/**
 * QA run 8: the first-visit Farah hint (a position:fixed card) sat at a fixed 84px from the top of the window. The cookie banner is IN the page flow above the sticky masthead, so while it
 * is showing (every fresh profile) the masthead's bottom is at about 145px, not 70px, and the card's first ~61px were hidden behind it; once the banner scrolls away or is answered the masthead
 * is back at 70px. From 760px up (where the card sits under the masthead) the card's top is now set from the masthead's MEASURED bottom, with 84px as the floor and a small gap, and kept
 * in step with scrolling and resizing. Below 760px the card is anchored to the bottom bar and none of this applies. The browser proof is
 * e2e/journey-seeker-farah-hint-under-cookie-banner.spec.ts (QA's, red before this change).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.join(__dirname, "../../src/components/app-shell/farah-first-visit-hint.tsx"), "utf8").replace(/\s+/g, " ");

describe("the first-visit Farah hint is placed below the masthead's measured bottom", () => {
  it("reads the masthead's bottom edge (not a constant)", () => {
    expect(source).toContain('[data-testid="masthead"]');
    expect(source).toMatch(/getBoundingClientRect\(\)\.bottom/);
  });
  it("keeps 84px as the floor and a gap under the masthead", () => {
    expect(source).toMatch(/Math\.max\(84,/);
  });
  it("only from 760px up, where the card sits under the masthead", () => {
    expect(source).toContain("(min-width: 760px)");
  });
  it("follows scroll and resize (the banner scrolls away) and cleans up", () => {
    expect(source).toContain('addEventListener("scroll"');
    expect(source).toContain('addEventListener("resize"');
    expect(source).toContain('removeEventListener("scroll"');
    expect(source).toContain('removeEventListener("resize"');
  });
  it("writes the position straight to the element (no state: no re-render per scroll event)", () => {
    expect(source).toMatch(/style\.top\s*=/);
  });
});
