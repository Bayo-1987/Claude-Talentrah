/**
 * A standing check, like tests/rls/column-privileges.test.ts: nothing under src/lib/employer/job-import may call `fetch` (or open its own `http`/`https` request) directly. Every request to a URL an employer controls
 * goes through `pinnedFetch` (src/lib/security/pinned-fetch.ts), which resolves the host once, checks every address and connects to that checked address. The robots.txt request used a plain fetch here for months,
 * before the page fetch ran its guard, and followed redirects anywhere; a new file in this folder (the employer job feed sync, the site-control proof fetch) that reaches for `fetch` would reopen exactly that.
 *
 * A source scan with comments and string literals removed, so a word in a comment or a message never trips it. To allow a direct call a file must be added to ALLOWED below, with a reason, in review.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(process.cwd(), "src/lib/employer/job-import");

/** Files allowed a direct network call, with the reason. Empty on purpose; shrink-only. */
const ALLOWED: Record<string, string> = {};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

/** Source with block and line comments and the contents of string and template literals removed. */
export function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:\\])\/\/[^\n]*/g, "$1 ")
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, "``")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''");
}

const DIRECT_CALL = /(?<![A-Za-z0-9_$])(?:globalThis\.|window\.|self\.)?fetch\s*\(/;
const OWN_TRANSPORT = /from\s*["'](?:node:)?(?:https?|undici|net|tls)["']|require\(\s*["'](?:node:)?(?:https?|undici)["']\s*\)/;

describe("src/lib/employer/job-import: every outbound request goes through pinnedFetch", () => {
  const all = files(ROOT);

  it("finds the files it is meant to scan (a scan of nothing would pass for the wrong reason)", () => {
    const names = all.map((f) => relative(ROOT, f));
    expect(names).toEqual(expect.arrayContaining(["fetch-page.ts", "robots.ts"]));
  });

  it("the two existing fetchers use pinnedFetch", () => {
    for (const name of ["fetch-page.ts", "robots.ts"]) {
      expect(readFileSync(join(ROOT, name), "utf8"), name).toMatch(/from "@\/lib\/security\/pinned-fetch"/);
    }
  });

  it("no file calls fetch directly or opens its own http(s) transport", () => {
    const offenders: string[] = [];
    for (const file of all) {
      const rel = relative(ROOT, file);
      if (rel in ALLOWED) continue;
      const src = code(readFileSync(file, "utf8"));
      if (DIRECT_CALL.test(src)) offenders.push(`${rel}: calls fetch(...) directly`);
      if (OWN_TRANSPORT.test(readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:\\])\/\/[^\n]*/g, "$1 "))) offenders.push(`${rel}: imports its own http/https/undici transport`);
    }
    expect(offenders, `Use pinnedFetch from "@/lib/security/pinned-fetch" (or add the file to ALLOWED with a reason):\n${offenders.join("\n")}`).toEqual([]);
  });

  it("the scan itself sees a direct call, a global-qualified call, and ignores comments and strings (so it can fail, and does not over-fail)", () => {
    expect(DIRECT_CALL.test(code("const r = await fetch(url);"))).toBe(true);
    expect(DIRECT_CALL.test(code("const r = await globalThis.fetch(url);"))).toBe(true);
    expect(DIRECT_CALL.test(code("const r = await   fetch (url);"))).toBe(true);
    expect(DIRECT_CALL.test(code("// fetch(url) is not allowed here\nconst x = 1;"))).toBe(false);
    expect(DIRECT_CALL.test(code("/* fetch(url) */ const x = 1;"))).toBe(false);
    expect(DIRECT_CALL.test(code('const msg = "fetch(url)";'))).toBe(false);
    expect(DIRECT_CALL.test(code("await pinnedFetch(url); await fetchWithSsrfGuard(u); fetchJobPage(x);"))).toBe(false);
    expect(OWN_TRANSPORT.test('import https from "node:https";')).toBe(true);
    expect(OWN_TRANSPORT.test('import { pinnedFetch } from "@/lib/security/pinned-fetch";')).toBe(false);
  });
});
