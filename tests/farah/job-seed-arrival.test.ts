/**
 * "Ask Farah" on a job: what the panel does the moment the job arrives (FARAH-JOB-CTX-1). The owner's report: the click handed the job to Farah and the options appeared, but the panel showed no visible change: the old
 * conversation stayed on screen, nothing scrolled, nothing said that something had happened. The rendering is tested in job-seed-block.test.tsx and the wiring in panel-job-seed-wiring.test.ts; real scrolling, focus and the
 * live region are e2e/farah-job-context-visible.spec.ts. This file is the part that needs no DOM: the arrival steps themselves, run against fake elements (this project's unit environment is plain Node).
 */
import { describe, expect, it, vi } from "vitest";
import { JOB_OPTION_SELECTOR, jobBlockScrollTarget, jobSeedAnnouncement, revealJobBlock } from "@/lib/farah/job-seed-arrival";

const SEED = { jobId: "job-42", jobTitle: "Backend Engineer", companyName: "Flutterwave" };

interface Geometry { scrollTop?: number; scrollerHeight?: number; blockTop: number; blockHeight: number }
/** A block in a scroller whose visible part runs from y=100 to y=100+scrollerHeight. */
function fakeBlock(option: "enabled" | "none" = "enabled", g: Geometry = { blockTop: 150, blockHeight: 200 }) {
  const optionFocus = vi.fn();
  const blockFocus = vi.fn();
  const scrollIntoView = vi.fn();
  const scrollTo = vi.fn();
  const scrollerHeight = g.scrollerHeight ?? 320;
  const querySelector = vi.fn((sel: string) => (option === "enabled" && sel === JOB_OPTION_SELECTOR ? { focus: optionFocus } : null));
  const scroller = { scrollTop: g.scrollTop ?? 500, clientHeight: scrollerHeight, getBoundingClientRect: () => ({ top: 100, bottom: 100 + scrollerHeight }), scrollTo };
  const block = { offsetHeight: g.blockHeight, parentElement: scroller, getBoundingClientRect: () => ({ top: g.blockTop, bottom: g.blockTop + g.blockHeight }), scrollIntoView, focus: blockFocus, querySelector };
  return { block, optionFocus, blockFocus, scrollIntoView, scrollTo, querySelector };
}

describe("the announcement", () => {
  it("names the job and the company, says the job is with Farah, and says nothing has been sent", () => {
    const text = jobSeedAnnouncement(SEED);
    expect(text).toContain("Backend Engineer");
    expect(text).toContain("Flutterwave");
    expect(text).toMatch(/Farah has/);
    expect(text).toMatch(/nothing has been sent/i);
  });
});

describe("revealJobBlock: scroll (the panel's own scroller, never the page)", () => {
  it("a block that fits but starts below the visible part is scrolled up into view by exactly the overshoot, smoothly", () => {
    const f = fakeBlock("enabled", { scrollTop: 500, blockTop: 350, blockHeight: 200 }); // visible 100..420, block 350..550: 130 too low
    revealJobBlock(f.block, false);
    expect(f.scrollTo).toHaveBeenCalledTimes(1);
    expect(f.scrollTo).toHaveBeenCalledWith({ top: 630, behavior: "smooth" });
  });
  it("a block that fits but starts above the visible part is scrolled back by the overshoot", () => {
    const f = fakeBlock("enabled", { scrollTop: 500, blockTop: 40, blockHeight: 200 });
    revealJobBlock(f.block, false);
    expect(f.scrollTo).toHaveBeenCalledWith({ top: 440, behavior: "smooth" });
  });
  it("a block TALLER than the scroller is scrolled to its top, so the chip and the first options are what is seen", () => {
    const f = fakeBlock("enabled", { scrollTop: 500, blockTop: 332 + 100, blockHeight: 478 });
    revealJobBlock(f.block, false);
    expect(f.scrollTo).toHaveBeenCalledWith({ top: 500 + 332, behavior: "smooth" });
  });
  it("a block already fully in view is not scrolled at all", () => {
    const f = fakeBlock("enabled", { scrollTop: 500, blockTop: 120, blockHeight: 200 });
    revealJobBlock(f.block, false);
    expect(f.scrollTo).not.toHaveBeenCalled();
  });
  it("does not animate for a reader who asked for reduced motion", () => {
    const f = fakeBlock("enabled", { scrollTop: 500, blockTop: 350, blockHeight: 200 });
    revealJobBlock(f.block, true);
    expect(f.scrollTo).toHaveBeenCalledWith({ top: 630, behavior: "auto" });
  });
  it("never scrolls the page: the block's own scrollIntoView is not used when there is a scroller", () => {
    const f = fakeBlock("enabled", { scrollTop: 500, blockTop: 350, blockHeight: 200 });
    revealJobBlock(f.block, false);
    expect(f.scrollIntoView).not.toHaveBeenCalled();
  });
  it("never scrolls above the top of the scroller", () => {
    const f = fakeBlock("enabled", { scrollTop: 10, blockTop: -300, blockHeight: 200 });
    revealJobBlock(f.block, false);
    expect(f.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });
  it("with no scroller to find, falls back to bringing the block into view by the least movement", () => {
    const f = fakeBlock();
    const orphan = { ...f.block, parentElement: null };
    revealJobBlock(orphan, false);
    expect(f.scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest", behavior: "smooth" });
  });
});

describe("jobBlockScrollTarget", () => {
  const scroller = { scrollTop: 100, clientHeight: 320, top: 0, bottom: 320 };
  it("returns null for a block that is in view, and the new scrollTop otherwise", () => {
    expect(jobBlockScrollTarget({ height: 100, top: 10, bottom: 110 }, scroller)).toBeNull();
    expect(jobBlockScrollTarget({ height: 100, top: 300, bottom: 400 }, scroller)).toBe(180);
    expect(jobBlockScrollTarget({ height: 100, top: -50, bottom: 50 }, scroller)).toBe(50);
    expect(jobBlockScrollTarget({ height: 480, top: 330, bottom: 810 }, scroller)).toBe(430);
    expect(jobBlockScrollTarget({ height: 480, top: 0, bottom: 480 }, scroller)).toBeNull();
  });
});

describe("revealJobBlock: focus", () => {
  it("moves keyboard focus to the first option that can be used, without letting the focus call scroll the page by itself", () => {
    const f = fakeBlock("enabled");
    expect(revealJobBlock(f.block, false)).toBe("option");
    expect(f.optionFocus).toHaveBeenCalledTimes(1);
    expect(f.optionFocus).toHaveBeenCalledWith({ preventScroll: true });
    expect(f.blockFocus).not.toHaveBeenCalled();
  });
  it("asks for an option that is not disabled", () => {
    const f = fakeBlock("enabled");
    revealJobBlock(f.block, false);
    expect(JOB_OPTION_SELECTOR).toContain("[data-job-option]");
    expect(JOB_OPTION_SELECTOR).toContain(":not([disabled])");
    expect(f.querySelector).toHaveBeenCalledWith(JOB_OPTION_SELECTOR);
  });
  it("when every option is disabled (a reply is streaming) focus goes to the block itself, so the keyboard still lands on the new job", () => {
    const f = fakeBlock("none");
    expect(revealJobBlock(f.block, false)).toBe("block");
    expect(f.blockFocus).toHaveBeenCalledWith({ preventScroll: true });
    expect(f.optionFocus).not.toHaveBeenCalled();
  });
  it("scrolls first, then focuses (focus never decides where the scroll ends)", () => {
    const order: string[] = [];
    const scroller = { scrollTop: 0, clientHeight: 320, getBoundingClientRect: () => ({ top: 0, bottom: 320 }), scrollTo: () => order.push("scroll") };
    const block = {
      offsetHeight: 100,
      parentElement: scroller,
      getBoundingClientRect: () => ({ top: 400, bottom: 500 }),
      scrollIntoView: () => order.push("scroll-into-view"),
      focus: () => order.push("block-focus"),
      querySelector: () => ({ focus: () => order.push("option-focus") }),
    };
    revealJobBlock(block, false);
    expect(order).toEqual(["scroll", "option-focus"]);
  });
});

describe("revealJobBlock: nothing to reveal", () => {
  it("does nothing, and does not throw, when the block is not on the page", () => {
    expect(revealJobBlock(null, false)).toBe("none");
  });
});
