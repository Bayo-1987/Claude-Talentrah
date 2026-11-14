/**
 * U3: the kill paths. With PWA_KILL=1 the served worker unsubscribes this browser's push subscription BEFORE it unregisters itself, and the page-side disabled path
 * unsubscribes each registration it unregisters. Both are guarded: no push manager, no subscription, a rejecting call, none of it may stop the unregister, or the
 * kill switch would fail open. The kill worker has no push or notificationclick handler of its own (it must answer nothing).
 */
import { describe, expect, it } from "vitest";
import { KILL_SOURCE } from "@/lib/pwa/service-worker-source";
import { startPwa, type PwaWindow } from "@/lib/pwa/bootstrap";
import { loadWorker } from "./support/worker-harness";

describe("the kill worker", () => {
  it("registers NO push and NO notificationclick handler", () => {
    const listeners = Object.keys(loadWorker(KILL_SOURCE).listeners);
    expect(listeners).not.toContain("push");
    expect(listeners).not.toContain("notificationclick");
  });

  it("the kill worker unsubscribes before unregistering", async () => {
    const w = loadWorker(KILL_SOURCE, { pushManager: { subscribed: true } });
    await w.runActivate();
    expect(w.log).toEqual(["unsubscribe", "unregister"]);
  });

  it("still unregisters when there is no subscription, no push manager, or the unsubscribe path rejects", async () => {
    const none = loadWorker(KILL_SOURCE, { pushManager: { subscribed: false } });
    await none.runActivate();
    expect(none.log).toEqual(["unregister"]);

    const noManager = loadWorker(KILL_SOURCE);
    await noManager.runActivate();
    expect(noManager.log).toEqual(["unregister"]);

    const rejecting = loadWorker(KILL_SOURCE, { pushManager: { subscribed: true, getSubscriptionRejects: true } });
    await rejecting.runActivate();
    expect(rejecting.log).toEqual(["unregister"]);

    const broken = loadWorker(KILL_SOURCE.replace("getSubscription", "getSubscriptionBroken"), { pushManager: { subscribed: true } });
    await broken.runActivate();
    expect(broken.log).toEqual(["unregister"]);
  });

  it("still deletes every cache and takes over at once", async () => {
    const w = loadWorker(KILL_SOURCE, { pushManager: { subscribed: true } });
    w.caches.names.add("talentrah-offline-v1");
    await w.runInstall();
    await w.runActivate();
    expect(w.calls.skipWaiting).toBe(1);
    expect(w.caches.deleted).toEqual(["talentrah-offline-v1"]);
  });
});

type FakeReg = { unregister: () => Promise<boolean>; pushManager?: { getSubscription?: () => Promise<{ unsubscribe: () => Promise<boolean> } | null> } };

function pageWith(regs: FakeReg[]) {
  const win = {
    location: { pathname: "/jobs" },
    document: { readyState: "complete" },
    navigator: { serviceWorker: { register: async () => ({}), getRegistrations: async () => regs } },
    caches: { keys: async () => [], delete: async () => true },
    addEventListener: () => undefined,
    dispatchEvent: () => true,
    setTimeout: (fn: () => void) => (fn(), 0),
  } as unknown as PwaWindow & Record<string, unknown>;
  win.self = win;
  win.top = win;
  return win;
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("the page-side disabled path", () => {
  it("unsubscribes every registration it unregisters, each before its own unregister", async () => {
    const log: string[] = [];
    const reg = (i: number): FakeReg => ({
      unregister: async () => (log.push(`unregister:${i}`), true),
      pushManager: { getSubscription: async () => ({ unsubscribe: async () => (log.push(`unsubscribe:${i}`), true) }) },
    });
    startPwa(pageWith([reg(0), reg(1), reg(2)]), false);
    await settle();
    for (const i of [0, 1, 2]) {
      expect(log, `registration ${i}`).toContain(`unsubscribe:${i}`);
      expect(log.indexOf(`unsubscribe:${i}`)).toBeLessThan(log.indexOf(`unregister:${i}`));
    }
  });

  it("is guarded: a registration with no push manager, no getSubscription, no subscription, a rejecting getSubscription or a throwing unsubscribe is still unregistered", async () => {
    const unregistered: string[] = [];
    const u = (name: string) => async () => (unregistered.push(name), true);
    const regs: FakeReg[] = [
      { unregister: u("no-manager") },
      { unregister: u("no-getSubscription"), pushManager: {} },
      { unregister: u("no-subscription"), pushManager: { getSubscription: async () => null } },
      { unregister: u("rejecting"), pushManager: { getSubscription: async () => Promise.reject(new Error("boom")) } },
      { unregister: u("throwing-unsubscribe"), pushManager: { getSubscription: async () => ({ unsubscribe: async () => Promise.reject(new Error("boom")) }) } },
    ];
    startPwa(pageWith(regs), false);
    await settle();
    expect(unregistered.sort()).toEqual(["no-getSubscription", "no-manager", "no-subscription", "rejecting", "throwing-unsubscribe"]);
  });

  it("the enabled path never unsubscribes anyone", async () => {
    let asked = 0;
    const regs: FakeReg[] = [{ unregister: async () => true, pushManager: { getSubscription: async () => (asked++, null) } }];
    startPwa(pageWith(regs), true);
    await settle();
    expect(asked).toBe(0);
  });
});
