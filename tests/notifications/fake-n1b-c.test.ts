import { beforeEach, describe, expect, it } from "vitest";
import { NotificationDbError } from "@/lib/notifications/contract-db";
import { FakeNotificationBackend } from "@/lib/notifications/fakes";

/** N1B FIX findings N1 and N2 in the fake: the same rules as tests/supabase/migration-0273-c-endpoint-case.test.ts. */
const U1 = "00000000-0000-4000-8000-0000000000a1";
const U2 = "00000000-0000-4000-8000-0000000000a2";
let fake: FakeNotificationBackend;
const refusal = async (p: Promise<unknown>) => p.then(() => "NOT REFUSED", (e: NotificationDbError) => `${e.info.sqlstate}/${e.info.reason ?? "-"}`);
const reg = (user: string, endpoint: string, over: Record<string, string> = {}) => fake.forCaller(user).registerPushSubscription({ p_endpoint: endpoint, p_p256dh: "k", p_auth: "a", p_ua: "Chrome", ...over });
const liveOf = (user: string) => fake.devices.filter((d) => d.user_id === user && d.revoked_at === null);
beforeEach(() => {
  fake = new FakeNotificationBackend(new Date("2026-10-26T12:00:00Z"));
  fake.addPerson({ id: U1 });
  fake.addPerson({ id: U2 });
});

describe("N1 in the fake: one endpoint, however the host is spelled", () => {
  it("the same person, two spellings: one row, the host stored in lower case, the path as typed", async () => {
    const a = await reg(U1, "https://FCM.GoogleAPIs.com/fcm/send/AbC-Path");
    const b = await reg(U1, "https://fcm.googleapis.com/fcm/send/AbC-Path");
    expect(b).toBe(a);
    expect(fake.devices.map((d) => d.endpoint)).toEqual(["https://fcm.googleapis.com/fcm/send/AbC-Path"]);
  });
  it("another person registering another spelling takes it over: one live row, the old one revoked", async () => {
    await reg(U1, "https://FCM.GoogleAPIs.com/fcm/send/AbC-Path");
    await reg(U2, "https://fcm.GOOGLEAPIS.com/fcm/send/AbC-Path");
    expect(fake.devices.filter((d) => d.revoked_at === null && d.endpoint === "https://fcm.googleapis.com/fcm/send/AbC-Path").map((d) => d.user_id)).toEqual([U2]);
    expect(fake.devices.find((d) => d.user_id === U1)!.revoke_reason).toBe("user");
  });
  it("the path keeps its case; a query or fragment after the host keeps its case", async () => {
    await reg(U1, "https://web.push.apple.com/AbC");
    await reg(U1, "https://WEB.push.apple.com/abc");
    await reg(U1, "https://UPDATES.push.services.mozilla.com?Q=AbC");
    await reg(U1, "https://Web2.Push.Apple.com#FrAg");
    expect(fake.devices.map((d) => d.endpoint).sort()).toEqual(["https://updates.push.services.mozilla.com?Q=AbC", "https://web.push.apple.com/AbC", "https://web.push.apple.com/abc", "https://web2.push.apple.com#FrAg"]);
  });
  it("the ten-device limit counts one endpoint once, in either spelling", async () => {
    for (let i = 0; i < 9; i++) await reg(U1, `https://fcm.googleapis.com/fcm/send/cap-${i}`);
    await reg(U1, "https://FCM.googleapis.com/fcm/send/cap-tenth");
    await reg(U1, "https://fcm.googleapis.com/fcm/send/cap-tenth");
    await reg(U1, "https://FCM.googleapis.com/fcm/send/cap-tenth");
    expect(liveOf(U1)).toHaveLength(10);
    expect(await refusal(reg(U1, "https://fcm.googleapis.com/fcm/send/cap-eleventh"))).toBe("P0001/device_limit");
    expect(await refusal(reg(U1, "https://FCM.GOOGLEAPIS.COM/fcm/send/cap-eleventh"))).toBe("P0001/device_limit");
  });
});
