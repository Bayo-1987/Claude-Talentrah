/**
 * U3: the page-side badge helper, syncBadge(count). One function, so every caller (load, visibilitychange, and each path that writes read_at, wired by the inbox
 * packages) does the same thing: the app badge equals the unread count, cleared at zero. It never throws: a browser without the Badging API, or one that refuses, is not an error.
 */
import { describe, expect, it } from "vitest";
import { syncBadge, type BadgeNavigator } from "@/lib/pwa/push/badge";

function nav(over: Partial<BadgeNavigator> = {}) {
  const calls = { set: [] as number[], clear: 0 };
  const n: BadgeNavigator = {
    setAppBadge: async (c?: number) => void calls.set.push(c as number),
    clearAppBadge: async () => void calls.clear++,
    ...over,
  };
  return { n, calls };
}

describe("syncBadge", () => {
  it("the badge equals the unread count", async () => {
    const { n, calls } = nav();
    await syncBadge(7, n);
    expect(calls.set).toEqual([7]);
  });

  it("the badge clears on open when nothing is unread, and resets to the real count when something is", async () => {
    const { n, calls } = nav();
    await syncBadge(0, n);
    expect(calls.clear).toBe(1);
    await syncBadge(3, n);
    expect(calls.set).toEqual([3]);
  });

  it("is not capped: 12 unread is a badge of 12 (the 9+ cap is the bell's text, not the badge)", async () => {
    const { n, calls } = nav();
    await syncBadge(12, n);
    expect(calls.set).toEqual([12]);
  });

  it.each([["a fraction", 1.5], ["negative", -2], ["NaN", Number.NaN], ["Infinity", Number.POSITIVE_INFINITY], ["a string", "7"], ["null", null], ["undefined", undefined]])(
    "%s changes nothing",
    async (_l, v) => {
      const { n, calls } = nav();
      await syncBadge(v as number, n);
      expect(calls.set).toEqual([]);
      expect(calls.clear).toBe(0);
    },
  );

  it("when the Badging API is missing nothing throws", async () => {
    await expect(syncBadge(5, {} as BadgeNavigator)).resolves.toBeUndefined();
    await expect(syncBadge(5, undefined)).resolves.toBeUndefined();
  });

  it("when only setAppBadge exists, a zero count does not throw", async () => {
    await expect(syncBadge(0, { setAppBadge: async () => undefined } as BadgeNavigator)).resolves.toBeUndefined();
  });

  it("a browser that refuses (the call rejects or throws) is swallowed", async () => {
    await expect(syncBadge(5, { setAppBadge: async () => Promise.reject(new Error("no")), clearAppBadge: async () => Promise.reject(new Error("no")) })).resolves.toBeUndefined();
    await expect(syncBadge(0, { setAppBadge: () => { throw new Error("sync"); }, clearAppBadge: () => { throw new Error("sync"); } } as unknown as BadgeNavigator)).resolves.toBeUndefined();
  });
});
