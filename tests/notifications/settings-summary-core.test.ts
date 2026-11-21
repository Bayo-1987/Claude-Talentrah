import { describe, expect, it } from "vitest";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "@/components/settings/notification-preferences-model";
import { loadNotificationSummary } from "@/app/(app)/settings/notification-summary-core";

function deps(over: { row?: Record<string, unknown> | null; sender?: boolean; readThrows?: boolean } = {}) {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      read: async () => {
        calls.push("read");
        if (over.readThrows) throw new Error("db down");
        return over.row === undefined ? null : over.row;
      },
      flagOn: async (key: string) => {
        calls.push(`flag:${key}`);
        return over.sender !== false;
      },
    },
  };
}

describe("the summary's inputs", () => {
  it("with the master flag off: nothing is read at all and there is no card", async () => {
    const d = deps();
    expect(await loadNotificationSummary(d.deps, "u1", false)).toBeNull();
    expect(d.calls).toEqual([]);
  });
  it("with the flag on and no saved row: the defaults, and the device state is asked for only when the push sender is on", async () => {
    const on = await loadNotificationSummary(deps().deps, "u1", true);
    expect(on).toEqual({ values: { ...DEFAULT_NOTIFICATION_PREFERENCES }, deviceEnabled: true });
    expect((await loadNotificationSummary(deps({ sender: false }).deps, "u1", true))?.deviceEnabled).toBe(false);
  });
  it("shows the saved row as saved", async () => {
    const s = await loadNotificationSummary(deps({ row: { push_enabled: true, push_match_alert: true, email_announcements: false } }).deps, "u1", true);
    expect(s?.values).toMatchObject({ push_enabled: true, push_match_alert: true, email_announcements: false, email_promotions: false });
  });
  it("a failing read means no card and nothing thrown (Settings must still render)", async () => {
    await expect(loadNotificationSummary(deps({ readThrows: true }).deps, "u1", true)).resolves.toBeNull();
  });
});
