/** The bell shows a count capped at "9+" (a number, not a meter): 9 shows as 9, 10 and above show as 9+. */
import { describe, expect, it } from "vitest";
import { BELL_COUNT_CAP, formatUnreadCount } from "@/lib/notifications/inbox/format";

describe("formatUnreadCount", () => {
  it("the cap is 9", () => expect(BELL_COUNT_CAP).toBe(9));
  it.each([
    [0, "0"],
    [1, "1"],
    [9, "9"],
    [10, '9+'],
    [11, '9+'],
    [250, '9+'],
  ])("%i is shown as %s", (n, shown) => expect(formatUnreadCount(n)).toBe(shown));
  it("a count that is not a usable number is shown as 0, never NaN or a negative", () => {
    for (const bad of [Number.NaN, -3, Number.POSITIVE_INFINITY * 0]) expect(formatUnreadCount(bad)).toBe("0");
  });
});
