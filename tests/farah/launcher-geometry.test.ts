/**
 * PHONE-ACTIONS-EDGE-1 (option C): the Farah launcher stands bottom LEFT, and the pages' action rows are built around that. The inset, the launcher's size and the column they reserve are
 * ONE set of constants (src/lib/farah/launcher-geometry.ts); the row classes that carry the reserve are literal strings (Tailwind reads them from source), so this holds them to the constants.
 */
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

  it("the job page's row is right-aligned below 760px with the launcher's column reserved on the LEFT, and is unchanged from 760px up", () => {
    expect(JOB_PAGE_ACTIONS_CLASS).toContain("max-[760px]:justify-end");
    expect(JOB_PAGE_ACTIONS_CLASS).toContain(`max-[760px]:pl-[${LAUNCHER_RESERVE_PX}px]`);
    expect(JOB_PAGE_ACTIONS_CLASS).not.toMatch(/max-\[760px\]:pr-/);
    // Every phone-only class is gated to the phone breakpoint, so from 760px up the row is what it always was.
    for (const c of JOB_PAGE_ACTIONS_CLASS.split(/\s+/)) if (/justify|pl-|pr-/.test(c)) expect(c.startsWith("max-[760px]:"), c).toBe(true);
    for (const c of JOB_CARD_ACTIONS_CLASS.split(/\s+/)) if (/pl-|pr-/.test(c)) expect(c.startsWith("max-[760px]:"), c).toBe(true);
  });
});
