/**
 * PHONE-ACTIONS-EDGE-1 (option C): the Farah launcher stands bottom LEFT, and the pages' action rows are built around that. The inset, the launcher's size and the column they reserve are
 * ONE set of constants (src/lib/farah/launcher-geometry.ts); the row classes that carry the reserve are literal strings (Tailwind reads them from source), so this holds them to the constants.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JOB_CARD_LEFT_CLEARANCE_PX, LAUNCHER_INSET_PX, LAUNCHER_RESERVE_PX, LAUNCHER_SIZE_PX } from "@/lib/farah/launcher-geometry";
import { JOB_CARD_ACTIONS_CLASS, JOB_PAGE_ACTIONS_CLASS } from "@/lib/jobs/action-row-classes";

describe("the launcher's geometry constants", () => {
  it("are a 56px circle, 16px in from the screen edge (kept at 16 so nothing sits in the iPhone back-swipe zone's way any closer), reserving 72px", () => {
    expect(LAUNCHER_SIZE_PX).toBe(56);
    expect(LAUNCHER_INSET_PX).toBe(16);
    expect(LAUNCHER_RESERVE_PX).toBe(LAUNCHER_SIZE_PX + LAUNCHER_INSET_PX);
    expect(LAUNCHER_RESERVE_PX).toBe(72);
  });
});

describe("the action rows' classes", () => {
  it("the job card's row ends at the card's content edge on a phone: right-aligned, NO reserve on the right, and only the small clearance on the left that keeps its first control out from under the launcher", () => {
    expect(JOB_CARD_ACTIONS_CLASS).toContain("justify-end");
    expect(JOB_CARD_ACTIONS_CLASS).not.toMatch(/max-\[760px\]:pr-/);
    expect(JOB_CARD_ACTIONS_CLASS).toContain(`max-[760px]:pl-[${JOB_CARD_LEFT_CLEARANCE_PX}px]`);
    expect(JOB_CARD_ACTIONS_CLASS).toContain("min-[760px]:flex-nowrap");
  });

  it("the card's clearance is what the launcher's column needs there: it reaches 8px past the launcher from the card's own content edge (24px page gutter + 1.5px border + 20px padding)", () => {
    const cardContentLeft = 24 + 1.5 + 20;
    expect(cardContentLeft + JOB_CARD_LEFT_CLEARANCE_PX).toBeGreaterThanOrEqual(LAUNCHER_RESERVE_PX + 8);
    expect(JOB_CARD_LEFT_CLEARANCE_PX, "no more than it needs: this is width taken from the controls").toBeLessThanOrEqual(LAUNCHER_RESERVE_PX + 8 - cardContentLeft + 2);
  });

  // Changed deliberately (the owner's call, 22 Nov): the job page's row used to be right-aligned below 760px with the launcher's column reserved on its LEFT (max-[760px]:justify-end,
  // max-[760px]:pl-[72px]). On a 390px phone that pushed every control away from the left edge. It is now left-aligned at every width, with no reserve; the page scrolls it clear of the launcher
  // instead (the end-of-page spacer, pinned below; the browser spec "scrolls clear of the launcher").
  it("the job page's row is LEFT-aligned at every width: no justify, no padding and no breakpoint-gated class at all", () => {
    expect(JOB_PAGE_ACTIONS_CLASS).toBe("flex flex-wrap items-center gap-3");
    expect(JOB_PAGE_ACTIONS_CLASS).not.toMatch(/justify-/);
    expect(JOB_PAGE_ACTIONS_CLASS).not.toMatch(/(^|\s)([a-z\[\]0-9-]+:)?(p|px|pl|pr|ml|mr)-/);
    expect(JOB_PAGE_ACTIONS_CLASS).not.toMatch(/max-\[760px\]:/);
    expect(JOB_PAGE_ACTIONS_CLASS).not.toContain(`${LAUNCHER_RESERVE_PX}px`);
    // The card's phone-only classes stay gated to the phone breakpoint, so from 760px up that row is what it always was.
    for (const c of JOB_CARD_ACTIONS_CLASS.split(/\s+/)) if (/pl-|pr-/.test(c)) expect(c.startsWith("max-[760px]:"), c).toBe(true);
  });

  it("what keeps the last controls of a page clear of the launcher is the shell's end-of-page spacer, as tall as the launcher's column", () => {
    const host = readFileSync(path.join(process.cwd(), "src/components/app-shell/farah-sheet-host.tsx"), "utf8");
    expect(host).toContain('data-testid="farah-launcher-spacer"');
    expect(host).toContain("height: `calc(${LAUNCHER_RESERVE_PX}px + env(safe-area-inset-bottom))`");
    expect(host).toContain("min-[760px]:hidden");
  });
});
