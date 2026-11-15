/**
 * The push opt-in button (U6), against the APPROVED U3b interface: getPushState, enablePush, reconcilePush, deviceTimezone (src/lib/pwa/push/client.ts on the U3b branch). U6 does not import that module (the
 * A1 base does not have it; assembly adds the one import line), so everything here runs against a double with exactly U3b's signatures.
 *
 * Killed mutants: M-opt-in-with-flags-off, M-prompt-on-load / enablePush-called-on-load, M-reprompt-when-blocked, M-button-on-needs-install, M-own-subscribe-logic.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { STALE_WORKER_TEXT } from "@/lib/pwa/push/client";
import {
  PushOptInView,
  createOptInController,
  shouldStartOptIn,
  type EnableResult,
  type PushClient,
  type PushState,
} from "@/components/settings/push-opt-in";

function double(state: PushState, enable: EnableResult = { ok: true }) {
  const calls: string[] = [];
  const client: PushClient = {
    getPushState: async () => {
      calls.push("getPushState");
      return state;
    },
    enablePush: async () => {
      calls.push("enablePush");
      return enable;
    },
    reconcilePush: async () => {
      calls.push("reconcilePush");
    },
    deviceTimezone: () => "Africa/Lagos",
  };
  return { client, calls };
}

describe("with the flags OFF nothing starts", () => {
  it("shouldStartOptIn is false unless the opt-in is enabled AND a client loader was given", () => {
    const load = vi.fn(async () => double("off").client);
    expect(shouldStartOptIn({ enabled: false, loadClient: load })).toBe(false);
    expect(shouldStartOptIn({ enabled: true, loadClient: undefined })).toBe(false);
    expect(shouldStartOptIn({ enabled: true, loadClient: load })).toBe(true);
    expect(load).not.toHaveBeenCalled();
  });
});

describe("loading the screen never prompts", () => {
  it("init asks the client for its STATE only: no enablePush, no reconcilePush", async () => {
    const { client, calls } = double("off");
    const ctl = createOptInController(async () => client);
    expect(await ctl.init()).toEqual({ phase: "ready", push: "off", message: null });
    expect(calls).toEqual(["getPushState"]);
  });
});

describe("the button", () => {
  it("a tap calls enablePush once; success turns the state on", async () => {
    const { client, calls } = double("off", { ok: true });
    const ctl = createOptInController(async () => client);
    await ctl.init();
    expect(await ctl.click()).toMatchObject({ phase: "ready", push: "on" });
    expect(calls).toEqual(["getPushState", "enablePush"]);
  });

  it("two quick taps still prompt once", async () => {
    const { client, calls } = double("off", { ok: true });
    const ctl = createOptInController(async () => client);
    await ctl.init();
    await Promise.all([ctl.click(), ctl.click()]);
    expect(calls.filter((c) => c === "enablePush")).toHaveLength(1);
  });

  it("a refusal in the permission prompt becomes the 'blocked' help and is NEVER prompted again", async () => {
    const { client, calls } = double("off", { ok: false, reason: "blocked" });
    const ctl = createOptInController(async () => client);
    await ctl.init();
    expect(await ctl.click()).toMatchObject({ push: "blocked" });
    await ctl.click();
    await ctl.click();
    expect(calls.filter((c) => c === "enablePush")).toHaveLength(1);
  });

  it("closing the prompt leaves the button, with a plain message", async () => {
    const { client } = double("off", { ok: false, reason: "dismissed" });
    const ctl = createOptInController(async () => client);
    await ctl.init();
    const next = await ctl.click();
    expect(next).toMatchObject({ push: "off" });
    expect(next.phase === "ready" && next.message).toMatch(/closed the permission prompt/i);
  });

  it.each([["blocked"], ["needs_install"], ["unsupported"], ["stale_worker"], ["on"]] as const)("when the state is %s a tap does not call enablePush", async (state) => {
    const { client, calls } = double(state);
    const ctl = createOptInController(async () => client);
    await ctl.init();
    await ctl.click();
    expect(calls).toEqual(["getPushState"]);
  });

  it("a client that cannot be loaded or throws leaves nothing broken", async () => {
    const ctl = createOptInController(async () => {
      throw new Error("chunk failed");
    });
    expect(await ctl.init()).toEqual({ phase: "failed" });
  });
});

describe("what each state shows", () => {
  const view = (state: PushState, message: string | null = null) => renderToStaticMarkup(<PushOptInView state={{ phase: "ready", push: state, message }} busy={false} onEnable={() => undefined} />);
  it("off: one button; nothing else claims notifications are on", () => {
    const html = view("off");
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain("Turn on notifications");
    expect(html).toContain('type="button"');
  });
  it("on: a status, no button", () => {
    const html = view("on");
    expect(html).not.toContain("<button");
    expect(html).toMatch(/on for this device/i);
  });
  it("blocked: settings help, no button", () => {
    const html = view("blocked");
    expect(html).not.toContain("<button");
    expect(html).toMatch(/blocked/i);
    expect(html).toMatch(/settings/i);
  });
  it("needs_install (an iPhone outside the Home Screen app): the install guidance, NO button", () => {
    const html = view("needs_install");
    expect(html).not.toContain("<button");
    expect(html).toMatch(/Home Screen/);
  });
  it("unsupported: plain text, no button", () => {
    const html = view("unsupported");
    expect(html).not.toContain("<button");
    expect(html).toMatch(/can.t show notifications/i);
  });
  it("stale_worker: U3b's own sentence, no button", () => {
    const html = view("stale_worker");
    expect(html).not.toContain("<button");
    expect(html).toContain("Close and reopen the app to turn on notifications");
  });
  it("loading and failed show nothing", () => {
    expect(renderToStaticMarkup(<PushOptInView state={{ phase: "loading" }} busy={false} onEnable={() => undefined} />)).toBe("");
    expect(renderToStaticMarkup(<PushOptInView state={{ phase: "failed" }} busy={false} onEnable={() => undefined} />)).toBe("");
  });
});

describe("the component contains no subscribe logic of its own", () => {
  const source = readFileSync(path.resolve(__dirname, "../../src/components/settings/push-opt-in.tsx"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  it("no permission, subscription or worker calls", () => {
    for (const forbidden of ["requestPermission", "pushManager", "serviceWorker", ".subscribe(", "Notification."]) expect(source, forbidden).not.toContain(forbidden);
  });
  it("imports nothing from the real client except the stale-worker sentence, and never loads it itself (the mount file does)", () => {
    const imports = [...source.matchAll(/import\s+([^;]*?)\s+from\s+["']@\/lib\/pwa\/push[^"']*["']/g)].map((m) => m[1]);
    expect(imports).toEqual(["{ STALE_WORKER_TEXT }"]);
    expect(source).not.toMatch(/import\(\s*["']@\/lib\/pwa\/push/);
  });
  it("the stale-worker line is U3b's own constant, whose text is the sentence the screen shows", () => {
    expect(STALE_WORKER_TEXT).toBe("Close and reopen the app to turn on notifications");
  });
  it("the effect that runs on load never calls enablePush, and the tap handler does", () => {
    const effect = /useEffect\(\(\) => \{([\s\S]*?)\}, \[/.exec(source)?.[1] ?? "";
    expect(effect.length).toBeGreaterThan(20);
    expect(effect).not.toContain("enablePush");
    expect(effect).not.toContain(".click(");
    expect(source).toMatch(/onEnable=\{[^}]*\.click\(/);
  });
});
