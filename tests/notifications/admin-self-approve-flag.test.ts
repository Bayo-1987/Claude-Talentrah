/**
 * The flag for "one operator may send an admin message without a second approver": admin_messaging_self_approve. This change only ADDS the flag (the key in the contract, its description, the row that seeds it,
 * OFF); nothing reads it yet. So the tests pin: the key, the description, the seed (one INSERT, enabled false, nothing else), the rollback, and the regression that matters: with the five existing flags
 * ON and the new one OFF or absent a send still starts, and the recorded flag_state is exactly what it was.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { NOTIFICATION_FLAGS } from "@/lib/notifications/contract";
import { FakeNotificationBackend } from "@/lib/notifications/fakes";
import { FLAG_DESCRIPTIONS } from "@/lib/admin/flags/descriptions";

const ROOT = path.resolve(__dirname, "../..");
const KEY = "admin_messaging_self_approve";
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const statements = (p: string) =>
  read(p)
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);

describe("the key and its description", () => {
  it("the contract spells the key exactly", () => {
    expect(NOTIFICATION_FLAGS.adminMessagingSelfApprove).toBe(KEY);
  });
  it("it has one plain sentence under 260 characters that ends with a full stop", () => {
    const text = (FLAG_DESCRIPTIONS as Record<string, string>)[KEY];
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(20);
    expect(text.length).toBeLessThan(260);
    expect(text.endsWith(".")).toBe(true);
    expect(text.slice(0, -1)).not.toContain(". ");
  });
});

describe("migration 0284", () => {
  const MIGRATION = "supabase/migrations/0284_admin_messaging_self_approve_flag.sql";
  it("is ONE statement: an INSERT of the flag row with enabled = false and ON CONFLICT DO NOTHING", () => {
    const s = statements(MIGRATION);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatch(/^insert into public\.feature_flags \(key, label, enabled\) values \('admin_messaging_self_approve', '[^']+', false\) on conflict \(key\) do nothing$/i);
  });
  it("nothing else in it: no update, delete, alter, create, drop, grant, and the word true appears nowhere", () => {
    const code = statements(MIGRATION).join(" ");
    for (const word of ["update", "delete", "alter", "create", "drop", "grant", "revoke", "truncate", "true"]) expect(code, word).not.toMatch(new RegExp(`\\b${word}\\b`, "i"));
  });
  it("its rollback deletes only that flag row", () => {
    const s = statements("supabase/rollbacks/0284_admin_messaging_self_approve_flag.rollback.sql");
    expect(s).toEqual([`delete from public.feature_flags where key = '${KEY}'`]);
  });
});

describe("the new flag changes nothing that exists", () => {
  const A = "00000000-0000-4000-8000-0000000000b2";
  const EXISTING = ["notifications_master", "admin_messaging", "admin_promotions", "admin_email"] as const;
  let fake: FakeNotificationBackend;
  beforeEach(() => {
    fake = new FakeNotificationBackend(new Date("2026-11-22T12:00:00Z"));
    fake.addAdmin(A, "a@example.test", ["user_messaging"]);
    EXISTING.forEach((k) => fake.setFlag(k, true));
  });
  const approved = (over: Record<string, unknown> = {}) => {
    const row = fake.addDraftMessage({ createdBy: A, requiresApproval: false, ...over } as never);
    row.status = "approved";
    return row;
  };
  const stops = (id: string) => fake.events.filter((e) => e.message_id === id && e.event === "flag_stopped").map((e) => e.flag_state);
  const start = (id: string) => fake.startAdminMessageSend({ p_message: id, p_actor: A });
  const setNew = (state: "on" | "off" | "absent") => {
    if (state !== "absent") fake.setFlag(NOTIFICATION_FLAGS.adminMessagingSelfApprove, state === "on");
  };

  it.each(["off", "absent"] as const)("with the existing flags ON and the new one %s a send starts and no stop is written", async (state) => {
    setNew(state);
    const m = approved();
    expect(await start(m.id)).not.toBeNull();
    expect(stops(m.id)).toEqual([]);
  });
  it("with the new flag ON the same send starts the same way (it is not read yet)", async () => {
    setNew("on");
    const m = approved();
    expect(await start(m.id)).not.toBeNull();
    expect(stops(m.id)).toEqual([]);
  });
  it.each(["on", "off", "absent"] as const)("flag_state is the same whatever the new flag is (%s): master off = 1, messaging off = 2, both = 3", async (state) => {
    setNew(state);
    const a = approved();
    fake.setFlag("notifications_master", false);
    await start(a.id);
    fake.setFlag("admin_messaging", false);
    await start(a.id);
    fake.setFlag("notifications_master", true);
    await start(a.id);
    expect(stops(a.id)).toEqual([1, 3, 2]);
  });
  it("the new flag alone being OFF, with the others ON, stops nothing; turning it ON stops nothing", async () => {
    const m = approved();
    setNew("off");
    expect(await start(m.id)).not.toBeNull();
    const n = approved();
    setNew("on");
    expect(await start(n.id)).not.toBeNull();
    expect([stops(m.id), stops(n.id)]).toEqual([[], []]);
  });
});
