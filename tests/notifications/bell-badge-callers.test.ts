/**
 * NOTIF-BADGE-CALLERS-1, the client side: the app badge is synced on load, on visibilitychange and after EVERY code path that writes read_at. The server side of the list (who writes read_at in src/) is
 * tests/notifications/inbox-scan.test.ts. Here: every place in the client code that calls a read-state endpoint, and the controller methods that do, call syncBadge; the bell wires load and visibilitychange.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const walk = (dir: string): string[] =>
  readdirSync(path.join(ROOT, dir)).flatMap((n) => {
    const rel = `${dir}/${n}`;
    return statSync(path.join(ROOT, rel)).isDirectory() ? walk(rel) : /\.(ts|tsx)$/.test(n) ? [rel] : [];
  });
const code = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("client code that calls a read-state endpoint", () => {
  const callers = walk("src")
    .filter((f) => !f.startsWith("src/app/api/"))
    .filter((f) => /\/api\/notifications\/(read-all|\$\{[^}]+\}\/read)/.test(code(f)) || /api\/notifications\/\$\{.*\}\/read/.test(code(f)));
  it("is exactly the bell controller", () => expect(callers).toEqual(["src/components/notifications/bell-controller.ts"]));
  it("and that file syncs the badge in every method that writes", () => {
    const c = code("src/components/notifications/bell-controller.ts");
    for (const method of ["markOne", "markAll", "load"]) {
      const start = c.indexOf(`async ${method}(`);
      expect(start, `${method} exists`).toBeGreaterThan(-1);
      const body = c.slice(start, c.indexOf("\n    },", start) === -1 ? undefined : c.indexOf("\n    },", start));
      expect(body, `${method} calls syncBadge`).toContain("deps.syncBadge(");
    }
  });
});

describe("the bell wires the badge to the page", () => {
  const bell = code("src/components/notifications/notification-bell.tsx");
  it("loads on mount, watches visibilitychange, and passes the real syncBadge", () => {
    expect(bell).toMatch(/useEffect\(\s*\(\) => \{[\s\S]*?\.load\(\)/);
    expect(bell).toContain("watchVisibility(");
    expect(bell).toMatch(/syncBadge,?/);
  });
  it("the controller's watcher listens for visibilitychange", () => {
    expect(code("src/components/notifications/bell-controller.ts")).toContain('"visibilitychange"');
  });
});
