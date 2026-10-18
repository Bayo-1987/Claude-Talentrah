/**
 * The early registration module (src/lib/pwa/bootstrap.ts), run against a fake window.
 *
 * It is rendered on every page by the root layout, so it is tiny and it guards itself: never inside a frame, never on /embed/*, and when the
 * kill switch is on it ONLY unregisters (a page that kept calling register would reinstall the self-destruct worker on every load, which is
 * the reload loop the earlier design had).
 */
import { describe, expect, it } from "vitest";
import { INSTALL_PROMPT_EVENT, INSTALL_PROMPT_KEY, startPwa, type PwaWindow } from "@/lib/pwa/bootstrap";

interface Registration {
  unregistered: number;
  unregister(): Promise<boolean>;
}

function fakeWindow(opts: { pathname?: string; framed?: boolean; readyState?: string; hasServiceWorker?: boolean; hasIdle?: boolean; registrations?: number; cacheNames?: string[] } = {}) {
  const log = { register: [] as [string, unknown][], deletedCaches: [] as string[], idleCalls: 0, timeoutCalls: 0, listeners: [] as string[] };
  const regs: Registration[] = Array.from({ length: opts.registrations ?? 0 }, () => ({
    unregistered: 0,
    async unregister() {
      this.unregistered++;
      return true;
    },
  }));
  const target = new EventTarget();
  const win = {
    location: { pathname: opts.pathname ?? "/jobs" },
    document: { readyState: opts.readyState ?? "complete" },
    navigator:
      opts.hasServiceWorker === false
        ? {}
        : {
            serviceWorker: {
              register: async (url: string, options: unknown) => {
                log.register.push([url, options]);
                return {};
              },
              getRegistrations: async () => regs,
            },
          },
    caches: {
      keys: async () => opts.cacheNames ?? [],
      delete: async (n: string) => {
        log.deletedCaches.push(n);
        return true;
      },
    },
    addEventListener(type: string, fn: EventListener, o?: unknown) {
      log.listeners.push(type);
      target.addEventListener(type, fn, o as AddEventListenerOptions);
    },
    dispatchEvent: (e: Event) => target.dispatchEvent(e),
    setTimeout: (fn: () => void) => {
      log.timeoutCalls++;
      fn();
      return 0;
    },
    ...(opts.hasIdle === false
      ? {}
      : {
          requestIdleCallback: (fn: () => void) => {
            log.idleCalls++;
            fn();
            return 0;
          },
        }),
  } as unknown as PwaWindow & Record<string, unknown>;
  (win as Record<string, unknown>).self = win;
  (win as Record<string, unknown>).top = opts.framed ? ({} as unknown) : win;
  return { win, log, regs, target };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("enabled: registers the worker", () => {
  it("registers /sw.js at scope / with updateViaCache none", async () => {
    const { win, log } = fakeWindow();
    startPwa(win, true);
    await flush();
    expect(log.register).toEqual([["/sw.js", { scope: "/", updateViaCache: "none" }]]);
  });

  it("waits for the load event and then for idle time, so it cannot touch LCP", async () => {
    const { win, log, target } = fakeWindow({ readyState: "loading" });
    startPwa(win, true);
    await flush();
    expect(log.register).toEqual([]);
    target.dispatchEvent(new Event("load"));
    await flush();
    expect(log.idleCalls).toBe(1);
    expect(log.register).toHaveLength(1);
  });

  it("falls back to a timeout where requestIdleCallback does not exist (Safari)", async () => {
    const { win, log } = fakeWindow({ hasIdle: false });
    startPwa(win, true);
    await flush();
    expect(log.timeoutCalls).toBe(1);
    expect(log.register).toHaveLength(1);
  });

  it("does nothing, and does not throw, where service workers do not exist", async () => {
    const { win, log } = fakeWindow({ hasServiceWorker: false });
    expect(() => startPwa(win, true)).not.toThrow();
    await flush();
    expect(log.register).toEqual([]);
  });

  it("swallows a registration failure (the app works without a worker)", async () => {
    const { win } = fakeWindow();
    (win.navigator.serviceWorker as unknown as { register: () => Promise<never> }).register = async () => {
      throw new Error("SecurityError");
    };
    expect(() => startPwa(win, true)).not.toThrow();
    await flush();
  });
});

describe("never inside a frame and never on /embed/*: no register, no listener, no unregister", () => {
  const cases: [string, Parameters<typeof fakeWindow>[0]][] = [
    ["a framed window", { framed: true }],
    ["/embed/jobs/abc", { pathname: "/embed/jobs/abc" }],
    ["/embed/ itself", { pathname: "/embed/" }],
    ["a framed /embed/ page", { framed: true, pathname: "/embed/jobs/abc" }],
  ];
  for (const enabled of [true, false]) {
    it.each(cases)(`${enabled ? "enabled" : "kill switch on"}: %s`, async (_label, o) => {
      const { win, log, regs } = fakeWindow({ ...o, registrations: 2, cacheNames: ["talentrah-offline-v1"] });
      startPwa(win, enabled);
      await flush();
      expect(log.register).toEqual([]);
      expect(log.listeners).toEqual([]);
      expect(regs.every((r) => r.unregistered === 0)).toBe(true);
      expect(log.deletedCaches).toEqual([]);
    });
  }

  it("does not treat /embedded or /x/embed/ as an embed page", async () => {
    for (const pathname of ["/embedded", "/x/embed/y"]) {
      const { win, log } = fakeWindow({ pathname });
      startPwa(win, true);
      await flush();
      expect(log.register, pathname).toHaveLength(1);
    }
  });
});

describe("disabled (kill switch): ONLY unregisters, NEVER registers", () => {
  it("unregisters every registration, deletes this app's caches only, and never calls register", async () => {
    const { win, log, regs } = fakeWindow({ registrations: 3, cacheNames: ["talentrah-offline-v1", "talentrah-offline-v0", "somebody-elses-cache"] });
    startPwa(win, false);
    await flush();
    expect(log.register).toEqual([]);
    expect(regs.map((r) => r.unregistered)).toEqual([1, 1, 1]);
    expect(log.deletedCaches.sort()).toEqual(["talentrah-offline-v0", "talentrah-offline-v1"]);
  });

  it("does not listen for beforeinstallprompt, so the install strip can never be offered", async () => {
    const { win, log } = fakeWindow();
    startPwa(win, false);
    await flush();
    expect(log.listeners).not.toContain("beforeinstallprompt");
    expect(log.listeners).not.toContain("load");
  });

  it("is a quiet no-op with no registrations, with no service worker support, and when a call rejects", async () => {
    startPwa(fakeWindow({ registrations: 0 }).win, false);
    startPwa(fakeWindow({ hasServiceWorker: false }).win, false);
    const { win } = fakeWindow({ registrations: 1 });
    (win.navigator.serviceWorker as unknown as { getRegistrations: () => Promise<never> }).getRegistrations = async () => {
      throw new Error("denied");
    };
    expect(() => startPwa(win, false)).not.toThrow();
    await flush();
  });
});

describe("beforeinstallprompt is captured early", () => {
  it("prevents the browser's own mini-infobar, keeps the event on window under one named property, and announces it", async () => {
    const { win, target } = fakeWindow();
    startPwa(win, true);
    const heard: Event[] = [];
    target.addEventListener(INSTALL_PROMPT_EVENT, (e) => heard.push(e));
    const ev = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt: async () => undefined });
    win.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect((win as unknown as Record<string, unknown>)[INSTALL_PROMPT_KEY]).toBe(ev);
    expect(heard).toHaveLength(1);
  });

  it("uses the documented property and event names", () => {
    expect(INSTALL_PROMPT_KEY).toBe("__talentrahInstallPrompt");
    expect(INSTALL_PROMPT_EVENT).toBe("talentrah:installprompt");
  });

  it("keeps the latest event if the browser fires it again", () => {
    const { win } = fakeWindow();
    startPwa(win, true);
    const first = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt: async () => undefined });
    const second = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt: async () => undefined });
    win.dispatchEvent(first);
    win.dispatchEvent(second);
    expect((win as unknown as Record<string, unknown>)[INSTALL_PROMPT_KEY]).toBe(second);
  });
});
