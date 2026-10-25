import { beforeEach, describe, expect, it } from "vitest";
import { NotificationDbError } from "@/lib/notifications/contract-db";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeNotificationBackend } from "@/lib/notifications/fakes";
import { normalisePushEndpoint } from "@/lib/notifications/fakes/fake-backend";

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

describe("N2 in the fake: registering one's own device again refreshes the browser name, keys and zone", () => {
  it("all of them", async () => {
    await reg(U1, "https://fcm.googleapis.com/fcm/send/refresh");
    await reg(U1, "https://fcm.googleapis.com/fcm/send/refresh", { p_p256dh: "k2", p_auth: "a2", p_ua: "Firefox", p_timezone: "Europe/London" });
    const row = fake.devices[0];
    expect([row.ua_short, row.p256dh, row.auth, row.timezone]).toEqual(["Firefox", "k2", "a2", "Europe/London"]);
  });
});

describe("N1B-NOTES-1 F5: normalisePushEndpoint is total and its comment is on the right function", () => {
  it.each(["http://x", "HTTPS://FCM.googleapis.com/x", "ftp://x", "https:/x", "", "x", " https://fcm.googleapis.com/x"])("an input that is not an https endpoint is returned unchanged, not thrown at: %j", (input) => {
    expect(() => normalisePushEndpoint(input)).not.toThrow();
    expect(normalisePushEndpoint(input)).toBe(input);
  });
  it("an https endpoint: the host in lower case, the rest as typed, including an empty host and a host with nothing after it", () => {
    expect(normalisePushEndpoint("https://FCM.GoogleAPIs.com/Fcm/Send/AbC")).toBe("https://fcm.googleapis.com/Fcm/Send/AbC");
    expect(normalisePushEndpoint("https://FCM.googleapis.com?Q=AbC#FrAg")).toBe("https://fcm.googleapis.com?Q=AbC#FrAg");
    expect(normalisePushEndpoint("https://FCM.GOOGLEAPIS.COM")).toBe("https://fcm.googleapis.com");
    expect(normalisePushEndpoint("https://")).toBe("https://");
  });
  it("each of the two functions carries its own doc comment, directly above it", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/notifications/fakes/fake-backend.ts"), "utf8");
    const docAbove = (name: string) => {
      const at = source.indexOf(`export function ${name}(`);
      const before = source.slice(0, at).trimEnd();
      return before.endsWith("*/") ? before.slice(before.lastIndexOf("/**")) : "";
    };
    expect(docAbove("isAllowedPushEndpoint")).toContain("The same host rule as the device registration in the database");
    expect(docAbove("normalisePushEndpoint")).toContain("The endpoint as stored");
    expect(docAbove("normalisePushEndpoint")).not.toContain("The same host rule");
    expect(docAbove("isAllowedPushEndpoint")).not.toContain("The endpoint as stored");
  });
});
