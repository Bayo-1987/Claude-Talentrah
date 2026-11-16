/**
 * NAV-DROPDOWN-REALIGN-1: Refer a Friend in the account menu, seekers only, with the sign-out form left exactly as U7 made it.
 *
 * The open menu is not in the markup until someone clicks, so the pure items component (AccountMenuItems) is rendered directly: no module mocks, no DOM library.
 * The sign-out wrapper is found by TYPE in the element tree (it must still be PushCleanupForm, not a plain form) and then driven with the hook harness of tests/notifications/push/signout-form.test.tsx.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const h = vi.hoisted(() => ({ cur: null as null | { useRef: (i: unknown) => unknown } }));
vi.mock("react", async (orig) => {
  const real = await orig<typeof import("react")>();
  return { ...real, useRef: (i: unknown) => h.cur?.useRef(i) ?? real.useRef(i) };
});

import { AccountMenuItems } from "@/components/app-shell/account-menu";
import { PushCleanupForm } from "@/components/app-shell/push-cleanup-form";
import { farahLauncherAllowedFor, FARAH_LAUNCHER_DENIED_PATHS } from "@/lib/farah/launcher-rules";

const BASE = { email: "ada@example.test", displayName: "Ada Bello", settingsHref: "/settings", itemClass: "min-h-10", onNavigate: () => undefined };

function labels(markup: string): string[] {
  return [...markup.matchAll(/role="menuitem"[^>]*>([^<]+)</g)].map((m) => m[1]);
}

describe("Refer a Friend in the account menu", () => {
  it("a seeker (referHref given) sees it between Settings and Sign out, as a plain link to /refer", () => {
    const html = renderToStaticMarkup(<AccountMenuItems {...BASE} referHref="/refer" />);
    expect(labels(html)).toEqual(["Settings", "Refer a Friend", "Sign out"]);
    expect(html).toMatch(/<a [^>]*href="\/refer"[^>]*role="menuitem"|<a [^>]*role="menuitem"[^>]*href="\/refer"/);
  });
  it("an employer (no referHref) does not see it: the menu is exactly Settings and Sign out", () => {
    const html = renderToStaticMarkup(<AccountMenuItems {...BASE} />);
    expect(labels(html)).toEqual(["Settings", "Sign out"]);
    expect(html).not.toContain("Refer a Friend");
    expect(html).not.toContain("/refer");
  });
  it("a seeker who can also switch side sees Settings, Refer a Friend, the switch, then Sign out", () => {
    const html = renderToStaticMarkup(<AccountMenuItems {...BASE} referHref="/refer" switchSide={{ to: "employer", label: "Switch to Employer" }} />);
    expect(labels(html)).toEqual(["Settings", "Refer a Friend", "Switch to Employer", "Sign out"]);
  });
  it("the Refer link is not inside any form, so the one-PushCleanupForm and one-plain-form counts the other tests rely on do not move", () => {
    const withSwitch = renderToStaticMarkup(<AccountMenuItems {...BASE} referHref="/refer" switchSide={{ to: "employer", label: "x" }} />);
    expect(withSwitch.match(/<form/g)).toHaveLength(2); // the side switch and sign out, as before
    const forms = withSwitch.match(/<form[\s\S]*?<\/form>/g) ?? [];
    expect(forms.some((f) => f.includes("Refer a Friend"))).toBe(false);
  });
});

function findByType(node: ReactNode, type: unknown): ReactElement[] {
  const out: ReactElement[] = [];
  const walk = (n: ReactNode) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!isValidElement(n)) return;
    if (n.type === type) out.push(n);
    walk((n.props as { children?: ReactNode }).children);
  };
  walk(node);
  return out;
}

describe("Sign out stays the U7 form", () => {
  it("is still wrapped in PushCleanupForm exactly once, and still holds the Sign out button", () => {
    const tree = AccountMenuItems({ ...BASE, referHref: "/refer" }) as ReactElement;
    const wrappers = findByType(tree, PushCleanupForm);
    expect(wrappers).toHaveLength(1);
    expect(renderToStaticMarkup(wrappers[0])).toContain("Sign out");
  });

  class Inst {
    slots: unknown[] = [];
    cursor = 0;
    useRef = (init: unknown) => {
      const i = this.cursor++;
      if (!(i in this.slots)) this.slots[i] = { current: init };
      return this.slots[i];
    };
    render(props: Record<string, unknown>) {
      h.cur = this;
      this.cursor = 0;
      const out = (PushCleanupForm as unknown as (p: Record<string, unknown>) => ReactElement)(props);
      h.cur = null;
      return out;
    }
  }
  const submit = (inst: Inst, cleanup: () => Promise<void>) => {
    const log: string[] = [];
    const el = inst.render({ action: () => undefined, cleanup, children: "Sign out" });
    (el.props as { onSubmit: (e: unknown) => void }).onSubmit({ preventDefault: () => log.push("hold"), currentTarget: { requestSubmit: () => log.push("submit") } });
    return log;
  };
  afterEach(() => vi.unstubAllGlobals());

  it("the sign-out wrapper in the menu is the real PushCleanupForm: delayed when push permission is granted", async () => {
    const wrapper = findByType(AccountMenuItems({ ...BASE, referHref: "/refer" }) as ReactElement, PushCleanupForm)[0];
    expect(wrapper.type).toBe(PushCleanupForm);
    vi.stubGlobal("Notification", { permission: "granted" });
    vi.stubGlobal("navigator", { serviceWorker: {} });
    const cleanup = vi.fn(async () => undefined);
    const log = submit(new Inst(), cleanup);
    expect(log).toEqual(["hold"]);
    await new Promise((r) => setTimeout(r, 0));
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
  it.each(["default", "denied"] as const)("and NOT delayed when permission is %s: a plain submit, no cleanup", (permission) => {
    vi.stubGlobal("Notification", { permission });
    vi.stubGlobal("navigator", { serviceWorker: {} });
    const cleanup = vi.fn(async () => undefined);
    expect(submit(new Inst(), cleanup)).toEqual([]);
    expect(cleanup).not.toHaveBeenCalled();
  });
  it("and not delayed where there is no Notification API at all", () => {
    vi.stubGlobal("Notification", undefined);
    vi.stubGlobal("navigator", { serviceWorker: {} });
    const cleanup = vi.fn(async () => undefined);
    expect(submit(new Inst(), cleanup)).toEqual([]);
  });
});

describe("Ask Farah on the four phone pages", () => {
  it("the launcher is denied on exactly those four paths and allowed on every other", () => {
    expect([...FARAH_LAUNCHER_DENIED_PATHS]).toEqual(["/billing/callback", "/mentorship/book/callback", "/settings/account-deletion", "/settings/delete-account/confirm"]);
    for (const p of FARAH_LAUNCHER_DENIED_PATHS) expect(farahLauncherAllowedFor(p), p).toBe(false);
    for (const p of ["/jobs", "/jobs/abc", "/tracker", "/resume-builder", "/settings", "/billing", "/mentorship", "/mentorship/book", "/refer", "/dashboard"]) {
      expect(farahLauncherAllowedFor(p), p).toBe(true);
    }
  });
  it("the account menu offers no Ask Farah entry either, so the four pages have none by design", () => {
    expect(renderToStaticMarkup(<AccountMenuItems {...BASE} referHref="/refer" />)).not.toContain("Ask Farah");
  });
});
