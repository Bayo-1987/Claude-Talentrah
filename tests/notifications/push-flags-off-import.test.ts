import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Flags off, no VAPID variables: a page load, a deploy and a build must not throw. Importing every module the push routes and the sender are made of, with the three variables unset and with the
 * kill switch on, off and unset, must read no key, call no network and log nothing; and building the sender must not need a key until something is about to be sent.
 */
const NAMES = ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("with the VAPID variables unset and the flags off", () => {
  it.each([[undefined], ["0"], ["1"]])("importing the push routes and the sender's wiring does not throw (PWA_KILL=%s)", async (kill) => {
    const consoles = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const fetches = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in this test"));
    for (const name of NAMES) vi.stubEnv(name, "");
    vi.stubEnv("PWA_KILL", kill as string);
    vi.resetModules();
    for (const path of [
      "@/app/api/push/subscribe/route",
      "@/app/api/push/devices/route",
      "@/app/api/push/devices/remove/route",
      "@/lib/notifications/push/session-deps",
      "@/lib/notifications/push/wiring",
      "@/lib/notifications/push/web-push-transport",
    ]) {
      await expect(import(/* @vite-ignore */ path)).resolves.toBeDefined();
    }
    expect(fetches).not.toHaveBeenCalled();
    expect(consoles.every((c) => c.mock.calls.length === 0)).toBe(true);
  });

  it("building the sender without a key does not throw, and sending then sends nothing: the claim is released as a failure before sending", async () => {
    for (const name of NAMES) vi.stubEnv(name, "");
    const { createRealPushSender } = await import("@/lib/notifications/push/wiring");
    const sender = createRealPushSender({});
    const target = { deviceId: "d", endpoint: "https://push.example.test/send/none", p256dh: "p", auth: "a" };
    const payload = { v: 1 as const, kind: "match_alert" as const, title: "t", body: "b", url: "/dashboard", tag: "x", badge: null };
    const logs = vi.spyOn(console, "info").mockImplementation(() => undefined);
    expect((await sender.send(target, payload)).outcome).toBe("pre_send_failure");
    expect(JSON.stringify(logs.mock.calls)).not.toContain("push.example.test");
  });
});
