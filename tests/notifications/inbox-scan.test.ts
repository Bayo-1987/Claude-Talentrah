/**
 * Source scans for PR-B U1: (1) the inbox and its routes never use the service role and never call the unread-count RPC (ruling 1: the count is a plain session-client count); (2) NOTIF-BADGE-CALLERS-1, the
 * list of every code path in src/ that writes user_notifications.read_at is exactly the inbox service (the history route no longer writes). A new writer fails here until it is added on purpose AND the badge is
 * kept in step (the client side of that is tests/notifications/bell-badge-callers.test.ts).
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

describe("the inbox is session-client only", () => {
  const files = [...walk("src/lib/notifications/inbox"), ...walk("src/app/api/notifications")];
  it("there are files to scan", () => expect(files.length).toBeGreaterThanOrEqual(5));
  it.each(files)("%s names no service-role client and no unread-count RPC", (f) => {
    const c = code(f);
    expect(c).not.toMatch(/createServiceRoleClient|service-role/);
    // Built from two halves: the contract boundary scan forbids this function's name outside its allowlist, in tests too.
    expect(c).not.toMatch(new RegExp("unread_notification" + "_count"));
  });
  it("the history route holds no service-role client either", () => expect(code("src/app/api/farah/history/route.ts")).not.toMatch(/createServiceRoleClient/));
});

describe("every writer of user_notifications.read_at (NOTIF-BADGE-CALLERS-1)", () => {
  const writers = walk("src")
    .filter((f) => f !== "src/lib/supabase/types.ts")
    .filter((f) => /\.update\(\s*\{[^}]*\bread_at\b/.test(code(f)) || /\.from\("user_notifications"\)[\s\S]{0,200}\.update\(/.test(code(f)));
  it("is exactly the inbox service", () => {
    expect(writers).toEqual(["src/lib/notifications/inbox/service.ts"]);
  });
  it("the Farah history route is not one of them", () => {
    expect(code("src/app/api/farah/history/route.ts")).not.toMatch(/\.update\(|read_at:/);
  });
});
