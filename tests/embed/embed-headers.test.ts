/**
 * The one place a security header policy changes for the employer job-list widget (plan v2.1, owner-approved 7 Oct 2026): /embed/* may be framed by any site, every other route keeps
 * today's headers byte for byte.
 *
 * Today next.config.ts applies X-Frame-Options: DENY (enforced) and a Report-Only CSP with frame-ancestors 'none' to `/:path*`. An iframe cannot work under that, so the global rule's
 * source excludes `/embed/` and a second rule covers `/embed/:path+`. This test evaluates the real headers() and matches each URL against each rule's source with the same
 * path-to-regexp Next compiles, so what is pinned is what a request would actually receive: the embed path is framable under a strict enforced CSP with NO X-Frame-Options at all
 * (never ALLOW-FROM), and every other route (the whole top level of the app directory, plus the API and the look-alikes) is still DENY with today's report-only CSP.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// Next ships this compiled copy without types; it is the matcher Next itself uses for header sources.
// @ts-expect-error TS7016
import { match } from "next/dist/compiled/path-to-regexp";
import nextConfig from "../../next.config";

type Rule = { source: string; headers: Array<{ key: string; value: string }> };
const ROOT = join(__dirname, "../..");

/** The headers a request for `path` receives: every rule whose source matches, in order (a later rule's value for the same key wins, as in Next). */
export function headersFor(rules: Rule[], path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rule of rules) {
    if (!match(rule.source, { decode: decodeURIComponent })(path)) continue;
    for (const h of rule.headers) out[h.key] = h.value;
  }
  return out;
}

async function rules(): Promise<Rule[]> {
  return (await nextConfig.headers!()) as Rule[];
}

const EMBED = "/embed/jobs/6f1c1d52-1111-4222-8333-444455556666";

describe("the detector itself (so the pins are not vacuous)", () => {
  const demo: Rule[] = [
    { source: "/((?!embed/).*)", headers: [{ key: "X-Frame-Options", value: "DENY" }] },
    { source: "/embed/:path+", headers: [{ key: "Content-Security-Policy", value: "x" }] },
  ];
  it("applies the global rule to ordinary paths and the embed rule only under /embed/", () => {
    expect(headersFor(demo, "/jobs")).toEqual({ "X-Frame-Options": "DENY" });
    expect(headersFor(demo, "/embed/jobs/x")).toEqual({ "Content-Security-Policy": "x" });
    expect(headersFor(demo, "/embed")).toEqual({ "X-Frame-Options": "DENY" });
    expect(headersFor(demo, "/embedded")).toEqual({ "X-Frame-Options": "DENY" });
  });
});

describe("/embed/* may be framed, under a strict enforced policy", () => {
  it("sends no X-Frame-Options (never ALLOW-FROM) and no report-only frame-ancestors 'none'", async () => {
    const h = headersFor(await rules(), EMBED);
    expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain("x-frame-options");
    expect(h["Content-Security-Policy-Report-Only"]).toBeUndefined();
  });

  it("sends an ENFORCED strict CSP: no scripts, no connections, framable by any site, no forms", async () => {
    const csp = headersFor(await rules(), EMBED)["Content-Security-Policy"];
    expect(csp).toBeDefined();
    const directives = Object.fromEntries(csp.split(";").map((d) => d.trim().split(/\s+/)).map(([name, ...values]) => [name, values.join(" ")]));
    expect(directives["default-src"]).toBe("'none'");
    expect(directives["frame-ancestors"]).toBe("*");
    expect(directives["form-action"]).toBe("'none'");
    expect(directives["base-uri"]).toBe("'none'");
    expect(directives["style-src"]).toBe("'unsafe-inline'");
    expect(directives["img-src"]).toBe("https: data:");
    expect(directives["script-src"], "the embed document carries no script").toBeUndefined();
    expect(directives["connect-src"]).toBeUndefined();
  });

  it("keeps the rest of today's hardening: HSTS, nosniff, referrer policy", async () => {
    const h = headersFor(await rules(), EMBED);
    expect(h["Strict-Transport-Security"]).toBe("max-age=31536000; includeSubDomains");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  });
});

describe("every other route keeps today's headers", () => {
  /** The URL-space the app serves: each top-level directory of src/app (route groups flattened to their children) plus the look-alikes of /embed and the API. */
  function topLevelRoutes(): string[] {
    const app = join(ROOT, "src/app");
    const out = new Set<string>(["/"]);
    const walk = (dir: string, prefix: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (!statSync(p).isDirectory()) continue;
        if (/^\(.+\)$/.test(name)) walk(p, prefix);
        else if (!name.startsWith("[") && !name.startsWith("_") && name !== "embed") out.add(`${prefix}/${name}`);
      }
    };
    walk(app, "");
    return [...out];
  }
  const explicit = ["/", "/jobs", "/jobs/6f1c1d52-1111-4222-8333-444455556666", "/login", "/admin", "/api/farah/chat", "/embed", "/embedded", "/embeds/jobs/x", "/jobs/embed/x", "/api/embed/jobs/x"];

  it("the list of routes was actually read from the app directory", () => {
    expect(topLevelRoutes().length).toBeGreaterThan(15);
    expect(topLevelRoutes()).toEqual(expect.arrayContaining(["/employer", "/admin", "/api", "/login", "/jobs"]));
  });

  it("X-Frame-Options: DENY, the report-only CSP with frame-ancestors 'none', and no enforced CSP, on every route outside /embed/", async () => {
    const r = await rules();
    for (const path of new Set([...topLevelRoutes(), ...explicit])) {
      const h = headersFor(r, path);
      expect(h["X-Frame-Options"], path).toBe("DENY");
      expect(h["Content-Security-Policy-Report-Only"], path).toContain("frame-ancestors 'none'");
      expect(h["Content-Security-Policy"], path).toBeUndefined();
      expect(h["Strict-Transport-Security"], path).toBe("max-age=31536000; includeSubDomains");
    }
  });
});

describe("the carve-out is exactly /embed/ and nothing broader", () => {
  it("the global rule's source excludes only the literal 'embed/' prefix", async () => {
    const global = (await rules()).find((r) => r.headers.some((h) => h.key === "X-Frame-Options"));
    expect(global, "a rule that sends X-Frame-Options exists").toBeDefined();
    const lookaheads = [...global!.source.matchAll(/\(\?!([^)]*)\)/g)].map((m) => m[1]);
    expect(lookaheads).toEqual(["embed/"]);
  });

  it("no rule sends frame-ancestors * outside the /embed/ source", async () => {
    const wide = (await rules()).filter((r) => r.headers.some((h) => /frame-ancestors \*/.test(h.value)));
    expect(wide.map((r) => r.source)).toEqual(["/embed/:path+"]);
  });

  it("next.config.ts has not been edited around the test: the file still mentions frame-ancestors 'none' for the global CSP", () => {
    expect(readFileSync(join(ROOT, "next.config.ts"), "utf8")).toContain(`"frame-ancestors 'none'"`);
  });
});
