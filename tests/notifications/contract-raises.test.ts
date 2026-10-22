import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { NOTIFICATION_FLAGS } from "@/lib/notifications/contract";
import { CLAIM_REFUSALS, NOTIFICATION_REFUSAL_REASONS, NOTIFICATION_RPCS, NotificationDbError } from "@/lib/notifications/contract-db";
import { FakeNotificationBackend } from "@/lib/notifications/fakes";

/**
 * RULING B3. What raises and what is returned.
 *  - The claim function raises only 22023 (invalid argument) and 42501 (not
 *    permitted), and returns every business refusal as a row.
 *  - The release function raises P0001 only with the hint unknown_id.
 *  - Every other function raises 22023, 42501, or P0001 with the reason as the
 *    hint, from the existing 17 reason hints. No hint is added, removed or renamed.
 */
let fake: FakeNotificationBackend;
beforeEach(() => {
  fake = new FakeNotificationBackend(new Date("2026-10-26T12:00:00Z"));
});

const errorOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error, "expected the call to raise").toBeInstanceOf(NotificationDbError);
  return (error as NotificationDbError).info;
};

describe("B3: the 17 reason hints", () => {
  it("are exactly these, in this order: none added, removed or renamed", () => {
    expect([...NOTIFICATION_REFUSAL_REASONS]).toEqual([
      "email_release_refused", "invalid_release_reason", "flag_off", "consent_required", "audience_over_limit",
      "operator_daily_limit", "overall_daily_limit", "self_approval", "kind_not_confirmed", "invalid_state",
      "not_found", "unknown_id", "not_https", "value_too_long", "device_limit", "setting_key_unknown",
      "setting_value_out_of_range",
    ]);
  });

  it("every hint the fake can raise is one of them", () => {
    const source = readFileSync(path.resolve(__dirname, "../../src/lib/notifications/fakes/fake-backend.ts"), "utf8");
    const used = new Set<string>();
    for (const m of source.matchAll(/refuse\(\s*[^,()]+,\s*"([a-z_]+)"\s*\)/g)) used.add(m[1]);
    for (const m of source.matchAll(/fail\(\s*"[a-z_]+",\s*"[0-9A-Z]{5}",\s*"([a-z_]+)"/g)) used.add(m[1]);
    expect(used.size).toBeGreaterThan(10);
    for (const hint of used) expect(NOTIFICATION_REFUSAL_REASONS as readonly string[], hint).toContain(hint);
  });
});

describe("B3: the claim function", () => {
  const user = () => {
    const id = fake.newId();
    fake.addPerson({ id });
    return id;
  };
  const args = (over: Record<string, unknown> = {}) => ({ p_user: user(), p_kind: "match_alert", p_subject: fake.newId(), p_channel: "inapp", ...over });

  it("raises 22023 for invalid arguments: an unknown kind, an unknown channel, a window it cannot read", async () => {
    for (const bad of [{ p_kind: "nope" }, { p_channel: "sms" }, { p_window: "a while" }]) {
      expect(await errorOf(fake.invokeAs("service_role", NOTIFICATION_RPCS.claimNotification, args(bad)))).toMatchObject({
        code: "invalid_parameter", sqlstate: "22023",
      });
    }
  });

  it("raises 42501 for a caller who is not the service role (a signed-in person or an anonymous visitor)", async () => {
    for (const role of ["authenticated", "anon"] as const) {
      expect(await errorOf(fake.invokeAs(role, NOTIFICATION_RPCS.claimNotification, args()))).toMatchObject({
        code: "permission_denied", sqlstate: "42501",
      });
    }
    expect(fake.deliveries).toHaveLength(0); // nothing was claimed
  });

  it("returns every business refusal as a row and never raises for one", async () => {
    const seen = new Set<string>();
    const call = async (over: Record<string, unknown>) => {
      const row = (await fake.invokeAs("service_role", NOTIFICATION_RPCS.claimNotification, args(over))) as { id: string | null; refused: string | null };
      if (row.refused) seen.add(row.refused);
      return row;
    };
    const device = fake.addDevice({ userId: user() });
    await call({ p_user: device.user_id, p_channel: "push", p_device: fake.newId() }); // device_unavailable
    fake.setNow(new Date("2026-10-26T22:00:00Z"));
    await call({ p_user: device.user_id, p_channel: "push", p_device: device.id }); // quiet_hours
    fake.setNow(new Date("2026-10-26T12:00:00Z"));
    for (let i = 0; i < 4; i += 1) await call({ p_user: device.user_id, p_channel: "push", p_device: device.id }); // budget_cap on the 4th
    fake.putSetting("mass_email_cap_24h", 1, null);
    await call({ p_kind: "admin_message", p_channel: "email" });
    await call({ p_kind: "admin_message", p_channel: "email" }); // cap_24h
    fake.putSetting("mass_email_cap_24h", 100, null);
    fake.putSetting("mass_email_ceiling_month", 1, null);
    await call({ p_kind: "admin_message", p_channel: "email" }); // ceiling_month
    const dup = args();
    await call(dup);
    await call(dup); // already_claimed
    expect([...seen].sort()).toEqual([...CLAIM_REFUSALS].sort());
  });
});

describe("B3: the release function and everything else", () => {
  it("release raises P0001 only with the hint unknown_id; its other mistakes use 22023 and 42501 and keep their hints", async () => {
    const releaseCall = (over: Record<string, unknown>) =>
      fake.invokeAs("service_role", NOTIFICATION_RPCS.releaseNotification, { p_id: fake.newId(), p_reason: "gone", ...over });
    expect(await errorOf(releaseCall({}))).toMatchObject({ code: "refused", sqlstate: "P0001", reason: "unknown_id" });

    const push = await fake.claimNotification({ p_user: fake.newId(), p_kind: "match_alert", p_subject: fake.newId(), p_channel: "inapp" });
    expect(push.id).not.toBeNull();
    expect(await errorOf(releaseCall({ p_id: push.id, p_reason: "timeout" }))).toMatchObject({
      code: "invalid_parameter", sqlstate: "22023", reason: "invalid_release_reason",
    });
    const email = await fake.claimNotification({ p_user: fake.newId(), p_kind: "admin_message", p_subject: fake.newId(), p_channel: "email" });
    expect(await errorOf(releaseCall({ p_id: email.id }))).toMatchObject({
      code: "permission_denied", sqlstate: "42501", reason: "email_release_refused",
    });
  });

  it("no function other than release raises P0001 with the hint unknown_id; every raise is 22023, 42501 or P0001 with a listed hint", async () => {
    const operator = fake.newId();
    fake.addAdmin(operator, "op@example.test", ["user_messaging", "operators"]);
    for (const key of Object.values(NOTIFICATION_FLAGS)) fake.setFlag(key, true);
    const missing = fake.newId();
    const message = fake.addDraftMessage({ createdBy: operator });
    const sweep: [string, Record<string, unknown>][] = [
      [NOTIFICATION_RPCS.releaseNotification, { p_id: missing, p_reason: "gone" }],
      [NOTIFICATION_RPCS.markNotificationSent, { p_id: missing }],
      [NOTIFICATION_RPCS.resolveStaleClaim, { p_id: missing, p_actor: operator, p_resolution: "mark_sent" }],
      [NOTIFICATION_RPCS.submitAdminMessage, { p_message: missing, p_actor: operator }],
      [NOTIFICATION_RPCS.approveAdminMessage, { p_message: missing, p_actor: operator, p_kind_confirmed: "promotion" }],
      [NOTIFICATION_RPCS.cancelAdminMessage, { p_message: missing, p_actor: operator }],
      [NOTIFICATION_RPCS.startAdminMessageSend, { p_message: missing, p_actor: operator }],
      [NOTIFICATION_RPCS.recordAdminMessageTest, { p_message: missing, p_actor: operator }],
      [NOTIFICATION_RPCS.pauseAdminMessageSend, { p_message: missing, p_reason: "cap_24h" }],
      [NOTIFICATION_RPCS.resumeAdminMessageSend, { p_message: missing, p_actor: operator }],
      [NOTIFICATION_RPCS.prepareAdminMessage, { p_message: missing, p_actor: operator, p_max_audience: 500 }],
      [NOTIFICATION_RPCS.setNotificationSetting, { p_key: "nope", p_value: 5, p_actor: operator }],
      [NOTIFICATION_RPCS.setNotificationSetting, { p_key: "mass_email_cap_24h", p_value: -1, p_actor: operator }],
      [NOTIFICATION_RPCS.resolveAdminSegment, { p_key: "everyone", p_params: {}, p_actor: null }],
      [NOTIFICATION_RPCS.approveAdminMessage, { p_message: message.id, p_actor: operator, p_kind_confirmed: "promotion" }],
    ];
    const infos = [];
    for (const [name, call] of sweep) infos.push(await errorOf(fake.invokeAs("service_role", name as never, call)));
    expect(infos.length).toBe(sweep.length);
    for (const info of infos) {
      expect(["22023", "42501", "P0001"]).toContain(info.sqlstate);
      if (info.sqlstate === "P0001") expect(NOTIFICATION_REFUSAL_REASONS as readonly string[]).toContain(info.reason);
      if (info.reason === "unknown_id") expect(info.rpc).toBe(NOTIFICATION_RPCS.releaseNotification);
    }
    expect(infos.filter((i) => i.reason === "unknown_id")).toHaveLength(1);
  });
});
