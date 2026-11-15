/**
 * U3b: reconcile at load (src/lib/pwa/push/client.ts reconcilePush, and the gate that decides whether the client is even fetched, src/lib/pwa/push/gate.ts).
 * The PR-A regression rule: with every flag off, nothing registers on page load and nothing is sent. With the flags off nobody can have a push subscription (the subscribe route is closed),
 * so reconcile acts only when permission is already granted AND this browser already has a subscription; it never subscribes, never prompts, and sends at most once a day.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { reconcilePush } from "@/lib/pwa/push/client";
import { scheduleReconcile, type ReconcileWindow } from "@/lib/pwa/push/gate";
import { ENDPOINT, fakeEnv } from "./support/push-client-env";

const DAY = 24 * 60 * 60 * 1000;

describe("reconcilePush", () => {
  it("with a granted permission and an existing subscription it sends the same subscribe again, with the device timezone", async () => {
    const f = fakeEnv({ permission: "granted", subscribed: true });
    await reconcilePush(f.env);
    expect(f.posts).toEqual([{ url: "/api/push/subscribe", body: { endpoint: ENDPOINT, p256dh: "FAKE-P256DH", auth: "FAKE-AUTH", timezone: "Africa/Lagos" } }]);
  });

  it("never prompts and never subscribes, in any state", async () => {
    for (const o of [{}, { permission: "default" as const }, { permission: "granted" as const }, { permission: "granted" as const, subscribed: true }, { permission: "denied" as const, subscribed: true }]) {
      const f = fakeEnv(o);
      await reconcilePush(f.env);
      expect(f.calls.filter((c) => c === "requestPermission" || c === "subscribe"), JSON.stringify(o)).toEqual([]);
    }
  });

  it("granted but no subscription (it was dropped): sends nothing and does not re-subscribe", async () => {
    const f = fakeEnv({ permission: "granted", subscribed: false });
    await reconcilePush(f.env);
    expect(f.posts).toEqual([]);
    expect(f.calls).not.toContain("subscribe");
  });

  it("a permission that is default or denied sends nothing", async () => {
    for (const permission of ["default", "denied"] as const) {
      const f = fakeEnv({ permission, subscribed: true });
      await reconcilePush(f.env);
      expect(f.posts).toEqual([]);
    }
  });

  it("a stale active worker: nothing is sent", async () => {
    const f = fakeEnv({ permission: "granted", subscribed: true, workerVersion: "push-0" });
    await reconcilePush(f.env);
    expect(f.posts).toEqual([]);
  });

  it("at most once a day: a second load inside 24 hours sends nothing, one after it sends again", async () => {
    const f = fakeEnv({ permission: "granted", subscribed: true });
    await reconcilePush(f.env);
    await reconcilePush(f.env);
    expect(f.posts).toHaveLength(1);
    const later = fakeEnv({ permission: "granted", subscribed: true, storage: { ...f.storage }, now: 1_800_000_000_000 + DAY + 1 });
    await reconcilePush(later.env);
    expect(later.posts).toHaveLength(1);
  });

  it("the server's refusal (flags off later) is not retried until tomorrow either", async () => {
    const f = fakeEnv({ permission: "granted", subscribed: true, status: 403 });
    await reconcilePush(f.env);
    await reconcilePush(f.env);
    expect(f.posts).toHaveLength(1);
  });

  it("a network failure does not throw and does not start the daily wait (it is tried again next load)", async () => {
    const f = fakeEnv({ permission: "granted", subscribed: true, fetchThrows: true });
    await expect(reconcilePush(f.env)).resolves.toBeUndefined();
    expect(Object.keys(f.storage)).toEqual([]);
  });

  it("a request that never answers does not hang the page: it gives up", async () => {
    vi.useFakeTimers();
    const f = fakeEnv({ permission: "granted", subscribed: true, fetchHangs: true });
    let done = false;
    const p = reconcilePush(f.env).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await p;
    expect(done).toBe(true);
    vi.useRealTimers();
  });

  it("storage that throws is survived, and nothing it logs carries the endpoint", async () => {
    const f = fakeEnv({ permission: "granted", subscribed: true, status: 500 });
    f.env.store.getStamp = () => {
      throw new Error("blocked");
    };
    f.env.store.setStamp = () => {
      throw new Error("blocked");
    };
    await expect(reconcilePush(f.env)).resolves.toBeUndefined();
    expect(JSON.stringify(f.warns)).not.toContain("FAKE-ENDPOINT-TOKEN");
  });
});

describe("the load-time gate (flags off: nothing is fetched, registered or sent)", () => {
  const win = (permission: string | undefined): ReconcileWindow & { idle: Array<() => void> } => {
    const idle: Array<() => void> = [];
    return {
      idle,
      Notification: permission === undefined ? undefined : { permission },
      requestIdleCallback: (cb: () => void) => {
        idle.push(cb);
        return 1;
      },
      setTimeout: (cb: () => void) => {
        idle.push(cb);
        return 1;
      },
    } as unknown as ReconcileWindow & { idle: Array<() => void> };
  };

  it("permission not granted, or no Notification API: the client chunk is never even requested and nothing is scheduled", () => {
    for (const permission of ["default", "denied", undefined]) {
      const load = vi.fn(async () => ({ reconcilePush: async () => undefined }));
      const w = win(permission);
      scheduleReconcile(w, load);
      expect(w.idle, String(permission)).toEqual([]);
      expect(load).not.toHaveBeenCalled();
    }
  });

  it("permission granted: reconcile is scheduled for idle time (not run at once) and then loads the client and runs it once", async () => {
    const reconcile = vi.fn(async () => undefined);
    const load = vi.fn(async () => ({ reconcilePush: reconcile }));
    const w = win("granted");
    scheduleReconcile(w, load);
    expect(load).not.toHaveBeenCalled();
    expect(w.idle).toHaveLength(1);
    w.idle[0]();
    await new Promise((r) => setTimeout(r, 0));
    expect(load).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it("a load that fails does not throw into the page", async () => {
    const w = win("granted");
    scheduleReconcile(w, async () => {
      throw new Error("chunk failed");
    });
    expect(() => w.idle[0]()).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});

describe("the bootstrap hook (flags off, and PWA_KILL on or off)", () => {
  const src = readFileSync(path.resolve(__dirname, "../../src/components/pwa/pwa-bootstrap.tsx"), "utf8");

  it("only schedules reconcile when the bootstrap is enabled (the kill switch passes enabled=false), and loads the client lazily", () => {
    expect(src).toMatch(/if \(enabled\) scheduleReconcile\(window as unknown as ReconcileWindow, \(\) => import\("@\/lib\/pwa\/push\/client"\)\);/);
  });

  it("imports the gate statically and the client only through import(): the bootstrap chunk does not carry the client", () => {
    expect(src).toContain('from "@/lib/pwa/push/gate"');
    expect(src).not.toMatch(/^import .*@\/lib\/pwa\/push\/client/m);
  });

  it("the gate and the bootstrap never call requestPermission or register a push subscription", () => {
    const gate = readFileSync(path.resolve(__dirname, "../../src/lib/pwa/push/gate.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(gate + src).not.toMatch(/requestPermission|pushManager|\.subscribe\(|fetch\(/);
  });
});
