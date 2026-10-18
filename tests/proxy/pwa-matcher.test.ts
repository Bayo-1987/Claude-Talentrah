/**
 * The proxy matcher and the three installable-app paths (design note finding 3; build prompt section 5).
 *
 * /manifest.webmanifest, /sw.js and /offline are static, identical for every visitor and must never run the proxy: it would call
 * `auth.getUser()` on every request, stamp `last_active_at` from a file fetch, and send a person inside their 30-day deletion window to the
 * pending-deletion page for a manifest (the gate's own exemption regex allows extensions of 2-8 letters, so ".webmanifest" is not exempt, and
 * "/offline" has no extension at all).
 *
 * The matcher is evaluated the way Next does it: `getMiddlewareMatchers` compiles `config.matcher` (adding its own optional data-route
 * suffix) and `getMiddlewareRouteMatcher` tests a pathname against the compiled regexp. No hand-rolled regex.
 */
import { describe, expect, it } from "vitest";
import { getMiddlewareRouteMatcher } from "next/dist/shared/lib/router/utils/middleware-route-matcher";
import { config } from "@/proxy";

// Next's compiler for `config.matcher` is real but not in its published type declarations, so it is loaded untyped.
const { getMiddlewareMatchers } = (await import("next/dist/build/analysis/get-page-static-info")) as unknown as {
  getMiddlewareMatchers: (matcher: string | string[], nextConfig: object) => Parameters<typeof getMiddlewareRouteMatcher>[0];
};

const matches = getMiddlewareRouteMatcher(getMiddlewareMatchers(config.matcher, {}));
const runsProxy = (pathname: string) => matches(pathname, {} as never, {});

describe("proxy matcher: the three installable-app paths skip the proxy", () => {
  it.each(["/manifest.webmanifest", "/sw.js", "/offline"])("%s does not run the proxy", (p) => {
    expect(runsProxy(p)).toBe(false);
  });
});

describe("proxy matcher: the exclusions are anchored, so near misses still run the proxy", () => {
  it.each([
    "/offline-x",
    "/offline/",
    "/offline/x",
    "/sw.json",
    "/sw.js.map",
    "/xsw.js",
    "/manifest.webmanifestx",
    "/manifest.json",
    "/x/sw.js",
    "/x/offline",
    "/x/manifest.webmanifest",
  ])("%s still runs the proxy", (p) => {
    expect(runsProxy(p)).toBe(true);
  });
});

describe("proxy matcher: everything it matched before still matches, and what it excluded before is still excluded", () => {
  it.each(["/", "/jobs", "/jobs/123", "/admin", "/admin/login", "/api/x", "/dashboard", "/billing/callback", "/auth/callback", "/login", "/embed/jobs/abc"])(
    "%s runs the proxy",
    (p) => {
      expect(runsProxy(p)).toBe(true);
    },
  );

  it.each(["/_next/static/chunks/a.js", "/_next/image", "/favicon.ico", "/x.svg", "/icons/talentrah-mark-192.png", "/a/b.webp"])("%s does not", (p) => {
    expect(runsProxy(p)).toBe(false);
  });
});
