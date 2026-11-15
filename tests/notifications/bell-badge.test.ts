/** syncBadge(count): the app badge equals the unread count. A number only; clears at zero; does nothing for an unknown count; never throws when the Badging API is missing or rejects. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { syncBadge } from "@/components/notifications/badge";

const setNavigator = (value: Record<string, unknown>) => vi.stubGlobal("navigator", value);
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("syncBadge", () => {
  it("sets the badge to the count as a number", () => {
    const setAppBadge = vi.fn().mockResolvedValue(undefined);
    setNavigator({ setAppBadge, clearAppBadge: vi.fn() });
    syncBadge(7);
    expect(setAppBadge).toHaveBeenCalledWith(7);
    expect(typeof setAppBadge.mock.calls[0][0]).toBe("number");
  });
  it("the badge shows the real count, not the capped display (the bell's 9+ is only for the bell)", () => {
    const setAppBadge = vi.fn().mockResolvedValue(undefined);
    setNavigator({ setAppBadge, clearAppBadge: vi.fn() });
    syncBadge(23);
    expect(setAppBadge).toHaveBeenCalledWith(23);
  });
  it("clears the badge at zero", () => {
    const setAppBadge = vi.fn();
    const clearAppBadge = vi.fn().mockResolvedValue(undefined);
    setNavigator({ setAppBadge, clearAppBadge });
    syncBadge(0);
    expect(clearAppBadge).toHaveBeenCalledTimes(1);
    expect(setAppBadge).not.toHaveBeenCalled();
  });
  it("does nothing for an unknown count (null): a failed read must not clear a real badge", () => {
    const setAppBadge = vi.fn();
    const clearAppBadge = vi.fn();
    setNavigator({ setAppBadge, clearAppBadge });
    syncBadge(null);
    expect(setAppBadge).not.toHaveBeenCalled();
    expect(clearAppBadge).not.toHaveBeenCalled();
  });
  it("when the Badging API is missing nothing throws", () => {
    setNavigator({});
    expect(() => syncBadge(3)).not.toThrow();
    vi.stubGlobal("navigator", undefined);
    expect(() => syncBadge(3)).not.toThrow();
  });
  it("a rejected call is swallowed", async () => {
    setNavigator({ setAppBadge: vi.fn().mockRejectedValue(new Error("denied")), clearAppBadge: vi.fn() });
    expect(() => syncBadge(2)).not.toThrow();
    await Promise.resolve();
  });
});
