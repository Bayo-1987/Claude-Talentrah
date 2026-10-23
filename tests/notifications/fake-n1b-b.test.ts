import { beforeEach, describe, expect, it } from "vitest";
import { NotificationDbError, NOTIFICATION_REFUSAL_REASONS } from "@/lib/notifications/contract-db";
import { PUSH_ENDPOINT_HOSTS } from "@/lib/notifications/contract";
import { FakeNotificationBackend } from "@/lib/notifications/fakes";
import { isAllowedPushEndpoint } from "@/lib/notifications/fakes/fake-backend";

/**
 * N1B (0273) part B, in the fake: the same rules as tests/supabase/migration-0273-b-*.test.ts. Written AFTER the fake change (the database tests came first, red before the SQL); each
 * test here has a named mutant in the report that turns it red.
 */
const A2 = "00000000-0000-4000-8000-0000000000b2";
const A3 = "00000000-0000-4000-8000-0000000000b3";
const U1 = "00000000-0000-4000-8000-0000000000a1";
const U2 = "00000000-0000-4000-8000-0000000000a2";
let fake: FakeNotificationBackend;
const refusal = async (p: Promise<unknown>) => p.then(() => "NOT REFUSED", (e: NotificationDbError) => `${e.info.sqlstate}/${e.info.reason ?? "-"}`);
const FLAGS = ["notifications_master", "admin_messaging", "admin_promotions", "admin_email"] as const;
beforeEach(() => {
  fake = new FakeNotificationBackend(new Date("2026-10-26T12:00:00Z"));
  fake.addAdmin(A2, "a2@example.test", ["user_messaging"]);
  fake.addAdmin(A3, "A3@Example.Test", ["user_messaging"]);
  fake.addPerson({ id: U1 });
  fake.addPerson({ id: U2 });
  FLAGS.forEach((k) => fake.setFlag(k, true));
});
const approved = (by: string, over: Record<string, unknown> = {}) => {
  const row = fake.addDraftMessage({ createdBy: by, requiresApproval: false, ...over } as never);
  row.status = "approved";
  return row;
};
const states = (id: string) => fake.events.filter((e) => e.message_id === id && e.event === "flag_stopped").map((e) => e.flag_state);
const start = (id: string, actor = A2) => fake.startAdminMessageSend({ p_message: id, p_actor: actor });

describe("F8 in the fake: the stop is recorded once per message per set of flags that were off", () => {
  it("one stop while the same flags are off, whoever asks; irrelevant flags add nothing", async () => {
    const m = approved(A2);
    fake.setFlag("admin_messaging", false);
    await start(m.id); await start(m.id); await start(m.id, A3);
    expect(states(m.id)).toEqual([2]);
    fake.setFlag("admin_promotions", false); fake.setFlag("admin_email", false);
    await start(m.id);
    expect(states(m.id)).toEqual([2]);
  });
  it("another flag going off or coming back is a new stop; going back to an earlier state is a new stop again", async () => {
    const m = approved(A2);
    fake.setFlag("admin_messaging", false); await start(m.id);
    fake.setFlag("notifications_master", false); await start(m.id); await start(m.id);
    fake.setFlag("admin_messaging", true); await start(m.id);
    fake.setFlag("admin_messaging", false); await start(m.id);
    expect(states(m.id)).toEqual([2, 3, 1, 3]);
  });
  it("a promotion by e-mail counts all four flags; the e-mail flag does not count without e-mail, nor the promotions flag for an announcement", async () => {
    const p = approved(A2, { kind: "promotion", channels: ["inapp", "email"], consentLine: "You asked." });
    FLAGS.forEach((k) => fake.setFlag(k, false)); await start(p.id);
    fake.setFlag("admin_promotions", true); await start(p.id);
    fake.setFlag("admin_email", true); await start(p.id);
    expect(states(p.id)).toEqual([15, 11, 3]);
    FLAGS.forEach((k) => fake.setFlag(k, true));
    const noEmail = approved(A2, { kind: "promotion", consentLine: "You asked." });
    const announcementEmail = approved(A2, { channels: ["email"] });
    fake.setFlag("admin_promotions", false); fake.setFlag("admin_email", false);
    await start(noEmail.id); await start(announcementEmail.id);
    expect([states(noEmail.id), states(announcementEmail.id)]).toEqual([[4], [8]]);
  });
  it("an event from before N1B (no state) counts as different once; something else happening in between makes the next stop new; with every flag on the message starts and no stop is written", async () => {
    const m = approved(A2);
    fake.events.push({ id: fake.newId(), message_id: m.id, event: "flag_stopped", detail: {}, actor_admin_id: A2, actor_email: "a2@example.test", at: fake.now().toISOString(), flag_state: null });
    fake.setFlag("admin_messaging", false);
    await start(m.id); await start(m.id);
    expect(states(m.id)).toEqual([null, 2]);
    fake.events.push({ id: fake.newId(), message_id: m.id, event: "test_sent", detail: {}, actor_admin_id: A2, actor_email: "a2@example.test", at: fake.now().toISOString(), flag_state: null });
    await start(m.id);
    expect(states(m.id)).toEqual([null, 2, 2]);
    fake.setFlag("admin_messaging", true);
    expect(await start(m.id)).toBe(m.id);
    expect(states(m.id)).toEqual([null, 2, 2]);
  });
  it("only a stop event carries a state", async () => {
    const m = approved(A2);
    fake.setFlag("admin_messaging", false); await start(m.id);
    fake.setFlag("admin_messaging", true); await start(m.id);
    expect(fake.events.filter((e) => e.message_id === m.id && e.event !== "flag_stopped").every((e) => e.flag_state === null)).toBe(true);
  });
});

describe("the daily limit counts by the creator's address, lower-cased", () => {
  const sentBy = (address: string, n: number, by: string | null = null) => {
    for (let i = 0; i < n; i++) {
      const r = fake.addDraftMessage({ createdBy: A2, requiresApproval: false });
      r.status = "sent"; r.created_by = by; r.created_by_email = address; r.sent_started_at = new Date(fake.now().getTime() - 3_600_000).toISOString();
    }
  };
  it("a sixth start is refused for a creator whose id is gone, whatever the letter case of either address", async () => {
    sentBy("A3@EXAMPLE.TEST", 3); sentBy("a3@example.test", 2);
    const m = approved(A3); m.created_by = null; m.created_by_email = "a3@example.test";
    expect(await refusal(start(m.id))).toBe("P0001/operator_daily_limit");
    expect(m.status).toBe("approved");
  });
  it("another creator is not held", async () => {
    sentBy("a3@example.test", 5);
    const m = approved(A2);
    expect(await start(m.id)).toBe(m.id);
  });
  it("a prepare counts the acting admin's address, whatever the creator ids of those sends say", async () => {
    sentBy("A3@example.test", 5, null);
    const draft = fake.addDraftMessage({ createdBy: A3, segmentKey: "self_test" as never });
    expect(await refusal(fake.prepareAdminMessage({ p_message: draft.id, p_actor: A3, p_max_audience: 10 }))).toBe("P0001/operator_daily_limit");
    expect(draft.status).toBe("draft");
  });
});

describe("F4 in the fake: the host rule", () => {
  const register = (endpoint: string) => fake.forCaller(U1).registerPushSubscription({ p_endpoint: endpoint, p_p256dh: "k", p_auth: "a", p_ua: "Chrome" });
  it.each([
    "https://fcm.googleapis.com/fcm/send/x", "https://FCM.GoogleAPIs.com/x", "https://fcm.googleapis.com", "https://fcm.googleapis.com?x=1", "https://fcm.googleapis.com#frag",
    "https://updates.push.services.mozilla.com/wpush/v2/x", "https://web.push.apple.com/x", "https://a.push.apple.com/x", "https://wns2-ch1p.notify.windows.com/w/?token=x",
  ])("accepts %s", (e) => expect(isAllowedPushEndpoint(e)).toBe(true));
  it.each([
    "https://fcm.googleapis.com./x", "https://fcm.googleapis.com /x", "https://fcm.googleapis.com/a\tb", "https://fcm.googleapis.com/a\nb", "https://fcm.googleapis.com/a\\b",
    "https://evil.example\\@fcm.googleapis.com/x", "https://fcm.googleapis%2ecom/x", "https://%66cm.googleapis.com/x", "https://u@fcm.googleapis.com/x", "https://fcm.googleapis.com@evil.example/x",
    "https://fcm.googleapis.com:443/x", "https://fcm.googleapis.com:/x", "https://fcm.googleapis.com.evil.example/x", "https://evil-fcm.googleapis.com/x", "https://xfcm.googleapis.com/x",
    "https://googleapis.com/x", "https://evil.example/fcm.googleapis.com/x", "https://evil.example/?h=fcm.googleapis.com", "https://a.updates.push.services.mozilla.com/x",
    "https://push.services.mozilla.com/x", "https://push.apple.com/x", "https://evilpush.apple.com/x", "https://x.push.apple.com.evil.example/x", "https://notify.windows.com/x",
    "https://evilnotify.windows.com/x", "https://android.googleapis.com/gcm/send/x", "https://revoked.invalid/x", "https://push.example.invalid/x", "https://127.0.0.1/x",
    "https://user@web.push.apple.com/x", "https://user:pw@wns2.notify.windows.com/x", "https://web.push.apple.com:443/x", "https://wns2.notify.windows.com:8443/x", "https://web%2epush.apple.com/x",
    "https://web.push.apple.com./x", "https://[web.push.apple.com]/x", "https://we_b.push.apple.com/x", "https://we%b.notify.windows.com/x", "https://[::1]/x", "https:///x", "https://", "https://localhost/x", "http://fcm.googleapis.com/x",
  ])("refuses %j", (e) => expect(isAllowedPushEndpoint(e)).toBe(false));
  it("the register call answers host_not_allowed after the scheme and length checks and before the zone check", async () => {
    expect(await refusal(register("http://evil.example/x"))).toBe("P0001/not_https");
    expect(await refusal(register(`https://evil.example/${"x".repeat(2100)}`))).toBe("P0001/value_too_long");
    expect(await refusal(register("https://evil.example/x"))).toBe("P0001/host_not_allowed");
    expect(await refusal(fake.forCaller(U1).registerPushSubscription({ p_endpoint: "https://evil.example/x", p_p256dh: "k", p_auth: "a", p_ua: "Chrome", p_timezone: "Mars/Olympus" }))).toBe("P0001/host_not_allowed");
    expect(fake.devices).toHaveLength(0);
  });
  it("the list is the contract constant, and the reason is in the closed list", () => {
    expect(PUSH_ENDPOINT_HOSTS.exact).toEqual(["fcm.googleapis.com", "updates.push.services.mozilla.com"]);
    expect(PUSH_ENDPOINT_HOSTS.suffixes).toEqual(["push.apple.com", "notify.windows.com"]);
    expect(NOTIFICATION_REFUSAL_REASONS).toContain("host_not_allowed");
  });
});

describe("a take-over keeps the previous owner's first revoke reason and time", () => {
  const E = "https://fcm.googleapis.com/fcm/send/takeover";
  it("a row revoked earlier keeps its reason and time; a live row is revoked now with the reason user", async () => {
    const old = fake.addDevice({ userId: U1, endpoint: E, revoked: true });
    old.revoke_reason = "deleted";
    old.revoked_at = "2026-10-20T08:00:00.000Z";
    await fake.forCaller(U2).registerPushSubscription({ p_endpoint: E, p_p256dh: "k", p_auth: "a", p_ua: "Chrome" });
    expect([old.revoke_reason, old.revoked_at, old.endpoint, old.p256dh, old.auth]).toEqual(["deleted", "2026-10-20T08:00:00.000Z", `https://revoked.invalid/${old.id}`, "revoked", "revoked"]);
    const live = fake.addDevice({ userId: U1, endpoint: `${E}-2` });
    await fake.forCaller(U2).registerPushSubscription({ p_endpoint: `${E}-2`, p_p256dh: "k", p_auth: "a", p_ua: "Chrome" });
    expect([live.revoke_reason, live.revoked_at]).toEqual(["user", fake.now().toISOString()]);
  });
});
