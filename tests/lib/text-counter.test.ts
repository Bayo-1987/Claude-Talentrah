/**
 * The counter's announcements and the paste rule (S1-56, checks for a global audience).
 *
 * A screen reader must not hear the count on every keystroke, so the counter speaks only when the length crosses a threshold (80%, 90%,
 * the limit, over it). And pasting more than the box can take must never be cut off silently: the paste is refused and says by how much.
 */
import { describe, expect, it } from "vitest";
import { announcementFor, counterBucket, pasteVerdict } from "@/lib/text-counter";

describe("counterBucket", () => {
  it("is quiet until 80% of the limit, then 80, 90, full, over", () => {
    expect(counterBucket(0, 100)).toBe("quiet");
    expect(counterBucket(79, 100)).toBe("quiet");
    expect(counterBucket(80, 100)).toBe("eighty");
    expect(counterBucket(89, 100)).toBe("eighty");
    expect(counterBucket(90, 100)).toBe("ninety");
    expect(counterBucket(99, 100)).toBe("ninety");
    expect(counterBucket(100, 100)).toBe("full");
    expect(counterBucket(101, 100)).toBe("over");
  });
});

describe("announcementFor", () => {
  it("says nothing while the bucket does not change (not on every keystroke)", () => {
    expect(announcementFor(81, 100, "eighty")).toBeNull();
    expect(announcementFor(5, 100, "quiet")).toBeNull();
  });
  it("speaks when a threshold is crossed, in plain words with the numbers", () => {
    expect(announcementFor(80, 100, "quiet")).toBe("20 left before the limit of 100.");
    expect(announcementFor(90, 100, "eighty")).toBe("10 left before the limit of 100.");
    expect(announcementFor(100, 100, "ninety")).toBe("You have reached the limit of 100.");
    expect(announcementFor(103, 100, "full")).toBe("3 over the limit of 100.");
  });
  it("tells a person who deletes back under the limit", () => {
    expect(announcementFor(95, 100, "over")).toBe("5 left before the limit of 100.");
    expect(announcementFor(10, 100, "ninety")).toBe("");
  });
});

describe("pasteVerdict", () => {
  it("accepts a paste that fits", () => {
    expect(pasteVerdict("hello", 5, 5, " world", 20)).toEqual({ ok: true });
  });
  it("refuses a paste that would go over the limit, and says by how many", () => {
    expect(pasteVerdict("hello", 5, 5, " world", 8)).toEqual({ ok: false, over: 3 });
  });
  it("counts the selection being replaced", () => {
    expect(pasteVerdict("hello world", 0, 5, "hi", 8)).toEqual({ ok: true });
    expect(pasteVerdict("hello world", 0, 5, "hi there friend", 12)).toEqual({ ok: false, over: 9 });
  });
  it("lets a value that is already over the limit be edited down, never longer", () => {
    expect(pasteVerdict("x".repeat(30), 0, 10, "y".repeat(10), 20)).toEqual({ ok: true });
    expect(pasteVerdict("x".repeat(30), 0, 10, "y".repeat(11), 20)).toEqual({ ok: false, over: 1 });
  });
  it("counts a pasted CRLF line break as one character, like the box and the server", () => {
    expect(pasteVerdict("", 0, 0, "a\r\nb", 3)).toEqual({ ok: true });
  });
});

describe("the words never promise 'characters' (an emoji counts as two code units)", () => {
  it("no announcement says characters", () => {
    for (const len of [80, 90, 100, 103]) {
      const text = announcementFor(len, 100, len === 80 ? "quiet" : len === 90 ? "eighty" : len === 100 ? "ninety" : "full") ?? "";
      expect(text).not.toMatch(/character/i);
    }
  });
});
