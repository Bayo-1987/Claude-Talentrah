/**
 * U3b: the page-side push client's state check and opt-in (src/lib/pwa/push/client.ts). U6's button calls enablePush() from its click handler; nothing here builds a button or a screen.
 * The rules under test (spec 02 section 4, U7 addendum c): the opt-in appears only where serviceWorker, PushManager and Notification exist and, on iOS, the app is standalone;
 * Notification.requestPermission() is called directly in the click, before any other await; a denied permission is never re-prompted; a stale active worker blocks the subscribe;
 * the device timezone goes with the subscription. Only the browser's edges are faked (tests/pwa/support/push-client-env.ts).
 */
import { describe, expect, it } from "vitest";
import { enablePush, getPushState, STALE_WORKER_TEXT } from "@/lib/pwa/push/client";
import { ENDPOINT, VAPID_PUBLIC, fakeEnv } from "./support/push-client-env";

describe("getPushState", () => {
  it("never prompts and never subscribes, whatever the state", async () => {
    for (const o of [{}, { permission: "granted" as const }, { permission: "denied" as const }, { subscribed: true }, { ios: true }]) {
      const f = fakeEnv(o);
      await getPushState(f.env);
      expect(f.calls.filter((c) => c === "requestPermission" || c === "subscribe")).toEqual([]);
    }
  });

  it("unsupported without a service worker, without PushManager, without Notification, or without the public key", async () => {
    for (const o of [{ serviceWorker: false }, { pushManager: false }, { notification: false }, { vapid: undefined }]) {
      expect(await getPushState(fakeEnv(o).env), JSON.stringify(o)).toBe("unsupported");
    }
  });

  it("the iOS standalone gate: in a Safari tab it needs the Home Screen app, installed it is supported", async () => {
    expect(await getPushState(fakeEnv({ ios: true, standalone: false }).env)).toBe("needs_install");
    expect(await getPushState(fakeEnv({ ios: true, standalone: true }).env)).toBe("off");
  });

  it("outside iOS the standalone gate does not apply", async () => {
    expect(await getPushState(fakeEnv({ ios: false, standalone: false }).env)).toBe("off");
  });

  it("blocked when the permission is denied", async () => {
    expect(await getPushState(fakeEnv({ permission: "denied" }).env)).toBe("blocked");
  });

  it("on when a subscription exists; off when none", async () => {
    expect(await getPushState(fakeEnv({ permission: "granted", subscribed: true }).env)).toBe("on");
    expect(await getPushState(fakeEnv({ permission: "granted" }).env)).toBe("off");
  });

  it("stale_worker when the active worker is not the expected version, or never answers (an old worker); a current worker is fine", async () => {
    expect(await getPushState(fakeEnv({ workerVersion: "push-0" }).env)).toBe("stale_worker");
    expect(await getPushState(fakeEnv({ workerVersion: null }).env)).toBe("stale_worker");
    expect(await getPushState(fakeEnv({}).env)).toBe("off");
  });
});

describe("enablePush", () => {
  it("calls Notification.requestPermission() directly: it is the first thing that happens, before any other await", async () => {
    const f = fakeEnv({});
    const pending = enablePush(f.env);
    expect(f.calls, "recorded synchronously, before the first microtask").toEqual(["requestPermission"]);
    await pending;
  });

  it("subscribes with userVisibleOnly and the public key's bytes, then sends endpoint, keys and the device timezone to /api/push/subscribe", async () => {
    const f = fakeEnv({});
    const r = await enablePush(f.env);
    expect(r).toEqual({ ok: true });
    expect(f.subscribeOptions).toHaveLength(1);
    const opts = f.subscribeOptions[0] as { userVisibleOnly: boolean; applicationServerKey: Uint8Array };
    expect(opts.userVisibleOnly).toBe(true);
    expect(Buffer.from(opts.applicationServerKey).toString("base64url")).toBe(VAPID_PUBLIC);
    expect(f.posts).toEqual([{ url: "/api/push/subscribe", body: { endpoint: ENDPOINT, p256dh: "FAKE-P256DH", auth: "FAKE-AUTH", timezone: "Africa/Lagos" } }]);
  });

  it("with no readable timezone the field is left out, not sent as null text", async () => {
    const f = fakeEnv({ timezone: null });
    await enablePush(f.env);
    expect("timezone" in f.posts[0].body).toBe(false);
  });

  it("an existing browser subscription is reused, not replaced", async () => {
    const f = fakeEnv({ subscribed: true, permission: "granted" });
    await enablePush(f.env);
    expect(f.calls).not.toContain("subscribe");
    expect(f.posts).toHaveLength(1);
  });

  it("denied is never re-prompted: it answers blocked and the browser prompt is not called", async () => {
    const f = fakeEnv({ permission: "denied" });
    expect(await enablePush(f.env)).toEqual({ ok: false, reason: "blocked" });
    expect(f.calls).toEqual([]);
  });

  it("a prompt the person closes is 'dismissed' (not blocked), and nothing is subscribed or sent", async () => {
    const f = fakeEnv({ answer: "default" });
    expect(await enablePush(f.env)).toEqual({ ok: false, reason: "dismissed" });
    expect(f.calls).toEqual(["requestPermission"]);
  });

  it("a prompt answered 'denied' is 'blocked'", async () => {
    const f = fakeEnv({ answer: "denied" });
    expect(await enablePush(f.env)).toEqual({ ok: false, reason: "blocked" });
    expect(f.posts).toEqual([]);
  });

  it("unsupported and iOS-in-a-tab are refused WITHOUT prompting", async () => {
    const a = fakeEnv({ pushManager: false });
    expect(await enablePush(a.env)).toEqual({ ok: false, reason: "unsupported" });
    const b = fakeEnv({ ios: true, standalone: false });
    expect(await enablePush(b.env)).toEqual({ ok: false, reason: "needs_install" });
    expect(a.calls.concat(b.calls)).toEqual([]);
  });

  it("a stale active worker blocks the subscribe: stale_worker, no subscription, no request", async () => {
    const f = fakeEnv({ workerVersion: "push-0" });
    expect(await enablePush(f.env)).toEqual({ ok: false, reason: "stale_worker" });
    expect(f.calls).not.toContain("subscribe");
    expect(f.posts).toEqual([]);
  });

  it("the stale-worker text is the one the spec gives", () => {
    expect(STALE_WORKER_TEXT).toBe("Close and reopen the app to turn on notifications");
  });

  it("the server's 403 (flags off or kill switch) is 'refused', and the subscription this call created is removed again", async () => {
    const f = fakeEnv({ status: 403 });
    expect(await enablePush(f.env)).toEqual({ ok: false, reason: "refused" });
    expect(f.calls).toContain("unsubscribe");
  });

  it("401 is signed_out; any other failure, including a network error, is 'error' and never throws", async () => {
    expect(await enablePush(fakeEnv({ status: 401 }).env)).toEqual({ ok: false, reason: "signed_out" });
    expect(await enablePush(fakeEnv({ status: 500 }).env)).toEqual({ ok: false, reason: "error" });
    expect(await enablePush(fakeEnv({ fetchThrows: true }).env)).toEqual({ ok: false, reason: "error" });
  });

  it("nothing it logs carries the endpoint", async () => {
    const f = fakeEnv({ fetchThrows: true });
    await enablePush(f.env);
    const f2 = fakeEnv({ status: 500 });
    await enablePush(f2.env);
    expect(JSON.stringify([f.warns, f2.warns])).not.toContain("FAKE-ENDPOINT-TOKEN");
    expect(JSON.stringify([f.warns, f2.warns])).not.toContain("push.example.test");
  });
});
