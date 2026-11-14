/**
 * The shell must not add an uncached flag query per page load. The notifications_master read goes through ONE request-memoised function (React cache(), the same device getActivePass uses), so however many places
 * in one render ask, the flag table is read once; and the next request reads it again (it is NOT cached across requests: a flag turned off must take effect on the next load). React's cache() only memoises inside a
 * server render, so this test stands in for the render scope with a stub that memoises until the "request" ends; the source checks pin that the layout and the routes use the memoised function and nothing else.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const flag = vi.fn();
let scope = new Map<unknown, unknown>();
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: <A extends unknown[], R>(fn: (...args: A) => R) => {
    return (...args: A): R => {
      const key = `${fn.toString()}|${JSON.stringify(args)}`;
      if (!scope.has(key)) scope.set(key, fn(...args));
      return scope.get(key) as R;
    };
  },
}));
vi.mock("@/lib/flags/read", () => ({ isFeatureEnabled: flag }));

const { inboxEnabled } = await import("@/lib/notifications/inbox/enabled");

beforeEach(() => {
  scope = new Map();
  flag.mockReset().mockResolvedValue(false);
});

describe("inboxEnabled", () => {
  it("reads notifications_master once however many times one render asks", async () => {
    const answers = await Promise.all([inboxEnabled(), inboxEnabled(), inboxEnabled()]);
    await inboxEnabled();
    expect(answers).toEqual([false, false, false]);
    expect(flag).toHaveBeenCalledTimes(1);
    expect(flag).toHaveBeenCalledWith("notifications_master");
  });
  it("is per request: the next request reads the flag again, so a flag thrown off takes effect on the next load", async () => {
    flag.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await inboxEnabled()).toBe(true);
    scope = new Map(); // a new request
    expect(await inboxEnabled()).toBe(false);
    expect(flag).toHaveBeenCalledTimes(2);
  });
  it("fails closed: a flag read that throws is OFF, not an error in the layout", async () => {
    flag.mockRejectedValue(new Error("db down"));
    expect(await inboxEnabled()).toBe(false);
  });
});

const ROOT = path.resolve(__dirname, "../..");
const walk = (dir: string): string[] =>
  readdirSync(path.join(ROOT, dir)).flatMap((n) => {
    const rel = `${dir}/${n}`;
    return statSync(path.join(ROOT, rel)).isDirectory() ? walk(rel) : /\.(ts|tsx)$/.test(n) ? [rel] : [];
  });
const code = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s+/g, " ");

describe("who reads the flag, and who can make an unread request", () => {
  it("the layout and the inbox routes read the flag only through inboxEnabled (never the reader directly)", () => {
    for (const f of ["src/components/app-shell/app-shell.tsx", "src/lib/notifications/inbox/gate.ts"]) {
      const c = code(f);
      expect(c, f).toContain("inboxEnabled()");
      expect(c, f).not.toMatch(/isFeatureEnabled/);
    }
    expect(code("src/components/app-shell/app-shell.tsx").match(/inboxEnabled\(\)/g)).toHaveLength(1);
  });
  it("in src/, only enabled.ts calls the flag reader for notifications_master", () => {
    const readers = walk("src").filter((f) => /isFeatureEnabled\(\s*NOTIFICATION_FLAGS\.master/.test(code(f)));
    expect(readers).toEqual(["src/lib/notifications/inbox/enabled.ts"]);
  });
  it("with the flag off no unread request is made: the only caller of /api/notifications is the bell controller, the only importer of the bell is the masthead, and the masthead renders it behind the prop", () => {
    const callers = walk("src").filter((f) => !f.startsWith("src/app/api/") && /fetch(?:Impl)?\(\s*["'`]\/api\/notifications["'`]/.test(code(f))); // fetchers only: contract.ts merely lists the route name
    expect(callers).toEqual(["src/components/notifications/bell-controller.ts"]);
    const importers = walk("src").filter((f) => /from "@\/components\/notifications\/notification-bell"/.test(code(f)));
    expect(importers).toEqual(["src/components/app-shell/masthead.tsx"]);
    expect(code("src/components/app-shell/masthead.tsx")).toContain("{showNotificationBell && <NotificationBell />}");
  });
});
