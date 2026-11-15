/**
 * The notification preferences' server logic, with every outside thing injected: who the person is, the flags, the row. Killed mutants: M-user-id-from-input (the action takes a user id from the browser),
 * M-wrong-column-written, M-writes-with-master-off.
 */
import { describe, expect, it } from "vitest";
import { loadPreferencesScreen, savePreference, type PreferenceDeps } from "@/app/(app)/settings/notification-preferences-core";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "@/components/settings/notification-preferences-model";

function deps(over: { user?: string | null; master?: boolean; sender?: boolean; row?: Record<string, unknown> | null; writeOk?: boolean } = {}) {
  const writes: Array<{ userId: string; column: string; value: boolean }> = [];
  const reads: string[] = [];
  const d: PreferenceDeps = {
    sessionUserId: async () => (over.user === undefined ? "session-user" : over.user),
    flagOn: async (key) => (key === "notifications_master" ? over.master ?? true : over.sender ?? true),
    read: async (userId) => {
      reads.push(userId);
      return over.row === undefined ? null : over.row;
    },
    write: async (userId, column, value) => {
      writes.push({ userId, column, value });
      return over.writeOk ?? true;
    },
  };
  return { d, writes, reads };
}

describe("savePreference", () => {
  it("writes the one column for the SESSION user, and nothing else", async () => {
    const { d, writes } = deps();
    expect(await savePreference(d, { column: "push_match_alert", value: true })).toEqual({ ok: true, note: "push_off" });
    expect(writes).toEqual([{ userId: "session-user", column: "push_match_alert", value: true }]);
  });

  it("ignores a user id sent by the browser: the session user is the only one", async () => {
    const { d, writes } = deps();
    await savePreference(d, { column: "email_promotions", value: true, userId: "someone-else", user_id: "someone-else" } as never);
    expect(writes).toHaveLength(1);
    expect(writes[0].userId).toBe("session-user");
  });

  it.each([["job_match_digest"], ["user_id"], ["unsubscribe_token"], ["__proto__"], [""], [7], [null], [undefined]])("refuses the column %j before touching anything", async (column) => {
    const { d, writes, reads } = deps();
    expect(await savePreference(d, { column, value: true })).toEqual({ ok: false, error: "unknown_setting" });
    expect(writes).toEqual([]);
    expect(reads).toEqual([]);
  });

  it.each([["true"], [1], [0], [null], [undefined], [{}]])("refuses the value %j (only a real boolean is saved)", async (value) => {
    const { d, writes } = deps();
    expect(await savePreference(d, { column: "push_enabled", value })).toEqual({ ok: false, error: "unknown_setting" });
    expect(writes).toEqual([]);
  });

  it("signed out: no write", async () => {
    const { d, writes } = deps({ user: null });
    expect(await savePreference(d, { column: "push_enabled", value: true })).toEqual({ ok: false, error: "signed_out" });
    expect(writes).toEqual([]);
  });

  it("with the master flag OFF nothing is written", async () => {
    const { d, writes } = deps({ master: false });
    expect(await savePreference(d, { column: "email_announcements", value: false })).toEqual({ ok: false, error: "unavailable" });
    expect(writes).toEqual([]);
  });

  it("turning an event on while push is off saves it and says why nothing will send; with push on, or turning off, there is no note", async () => {
    expect(await savePreference(deps({ row: { push_enabled: false } }).d, { column: "push_new_applicant", value: true })).toEqual({ ok: true, note: "push_off" });
    expect(await savePreference(deps({ row: { push_enabled: true } }).d, { column: "push_new_applicant", value: true })).toEqual({ ok: true });
    expect(await savePreference(deps({ row: { push_enabled: false } }).d, { column: "push_new_applicant", value: false })).toEqual({ ok: true });
    expect(await savePreference(deps({ row: { push_enabled: false } }).d, { column: "email_promotions", value: true })).toEqual({ ok: true });
  });

  it("a write the database did not take is reported, not hidden", async () => {
    expect(await savePreference(deps({ writeOk: false }).d, { column: "push_enabled", value: true })).toEqual({ ok: false, error: "not_saved" });
  });
});

describe("loadPreferencesScreen", () => {
  it("signed out: no screen", async () => {
    expect(await loadPreferencesScreen(deps({ user: null }).d)).toEqual({ access: "signed_out" });
  });
  it("master flag OFF: the screen is off and the row is never even read", async () => {
    const { d, reads } = deps({ master: false });
    expect(await loadPreferencesScreen(d)).toEqual({ access: "off" });
    expect(reads).toEqual([]);
  });
  it("no row: the defaults (promotions off, announcements on); the opt-in follows the push sender flag", async () => {
    expect(await loadPreferencesScreen(deps({ sender: false }).d)).toEqual({ access: "ok", values: DEFAULT_NOTIFICATION_PREFERENCES, optInEnabled: false });
    expect(await loadPreferencesScreen(deps({ sender: true }).d)).toMatchObject({ access: "ok", optInEnabled: true });
  });
  it("a stored row is shown as stored", async () => {
    const screen = await loadPreferencesScreen(deps({ row: { push_enabled: true, email_announcements: false, email_promotions: true } }).d);
    expect(screen).toMatchObject({ access: "ok", values: { push_enabled: true, email_announcements: false, email_promotions: true, push_promotions: false } });
  });
});
