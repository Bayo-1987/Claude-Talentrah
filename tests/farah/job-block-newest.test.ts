/**
 * FARAH-JOB-CTX-1 round 2, question 1. The conversation scroller is 320px tall. A job block (divider, chip, label, opener, four options) is about 400px at the 280px column, so the fourth option, "Draft an intro
 * message", was below the scroller's fold at wide widths, and on a PRISTINE panel that is a regression: on origin/main the opener and four options were 283px and all four showed. While the job block is the
 * newest thing in the panel the scroller is therefore allowed more height (26rem); as soon as anything comes after it, the old height returns. This is the rule that says when.
 */
import { describe, expect, it } from "vitest";
import { jobBlockIsNewest } from "@/lib/farah/job-seed-arrival";

describe("jobBlockIsNewest", () => {
  it("a pristine panel showing a job: yes; a pristine panel with no job: no", () => {
    expect(jobBlockIsNewest({ messageCount: 0, hasPristineSeed: true, lastMarkerInsertAt: null })).toBe(true);
    expect(jobBlockIsNewest({ messageCount: 0, hasPristineSeed: false, lastMarkerInsertAt: null })).toBe(false);
  });
  it("a conversation whose last item is a job divider (nothing said since): yes", () => {
    expect(jobBlockIsNewest({ messageCount: 10, hasPristineSeed: true, lastMarkerInsertAt: 10 })).toBe(true);
  });
  it("a conversation where something was said after the last divider: no, the old height returns", () => {
    expect(jobBlockIsNewest({ messageCount: 12, hasPristineSeed: true, lastMarkerInsertAt: 10 })).toBe(false);
  });
  it("a conversation with no divider at all: no (the pristine seed does not show once there are messages)", () => {
    expect(jobBlockIsNewest({ messageCount: 10, hasPristineSeed: true, lastMarkerInsertAt: null })).toBe(false);
  });
});
