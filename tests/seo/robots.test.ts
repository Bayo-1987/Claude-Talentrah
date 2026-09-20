/**
 * send-407 — `/talent-directory/verify` was linked from the seeker masthead
 * nav (masthead.tsx's NAV_LINKS, "Get Verified") and gated by its own
 * page.tsx's requireUser() call, but had no matching robots.ts disallow —
 * crawlable and unblocked, serving a generic login redirect to anything
 * that fetched it. Same class of gap /mentorship's own sub-routes had
 * (send-385) — this is the second instance found in two days.
 *
 * Two things pinned here, not just the one instance:
 * 1. The specific fix (`/talent-directory/verify` is disallowed).
 * 2. A systematic, automated check — not just this one route — that scans
 *    every requireUser()-gated page.tsx under src/app and asserts each is
 *    covered by some robots.ts disallow pattern. Written because this
 *    exact class of gap has now happened twice; a check scoped to only the
 *    two known instances would not catch a third.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import robots from "@/app/robots";

const APP_DIR = join(process.cwd(), "src/app");

/** Every page.tsx under src/app whose own file calls requireUser(). */
function findRequireUserGatedRoutes(dir: string, routeSoFar = ""): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      // Route groups `(app)` etc. contribute no path segment; dynamic
      // segments `[id]` and parallel/intercepting conventions are kept
      // verbatim — this check only needs a stable, comparable STRING per
      // route, not a resolvable URL.
      const segment = entry.startsWith("(") ? "" : `/${entry}`;
      routes.push(...findRequireUserGatedRoutes(fullPath, routeSoFar + segment));
    } else if (entry === "page.tsx") {
      const content = readFileSync(fullPath, "utf-8");
      if (/\brequireUser\s*\(/.test(content)) {
        routes.push(routeSoFar || "/");
      }
    }
  }
  return routes;
}

/**
 * The same matching semantics robots.txt disallow entries actually use: a
 * trailing `$` is an EXACT match, anything else is a PREFIX match — matches
 * how Google (and every other real crawler) interprets these rules, and how
 * this file's own comments already describe "/jobs$" vs "/mentorship/".
 */
function isCoveredByDisallow(route: string, disallow: string[]): boolean {
  return disallow.some((pattern) => {
    if (pattern.endsWith("$")) return route === pattern.slice(0, -1);
    if (route === pattern) return true;
    return route.startsWith(pattern.endsWith("/") ? pattern : `${pattern}/`);
  });
}

describe("robots.ts disallows every requireUser()-gated route", () => {
  const { rules } = robots();
  const rule = Array.isArray(rules) ? rules[0] : rules;
  const disallow = (Array.isArray(rule?.disallow) ? rule.disallow : [rule?.disallow]).filter(
    (d): d is string => typeof d === "string",
  );

  it("disallows /talent-directory/verify specifically", () => {
    expect(disallow).toContain("/talent-directory/verify");
  });

  /*
   * A known, deliberate exception, not a gap: findRequireUserGatedRoutes'
   * plain "does the string requireUser( appear in this file" scan (a
   * text-content check, not a control-flow one) flags bare /mentorship
   * itself, because mentorship/(list)/page.tsx calls requireUser() inside
   * its AUTHENTICATED branch (to power the signed-in browse view) — not as
   * a page-level gate blocking the whole route the way every other entry
   * here works. send-385 made that deliberate: a signed-out visitor gets a
   * real public landing page, not a redirect, so /mentorship correctly has
   * no robots.ts disallow at all. A smarter (branch-aware) static check
   * could tell these apart automatically; an explicit, documented exception
   * is simpler and more honest about what a text scan can't actually prove.
   */
  const KNOWN_DUAL_PURPOSE_ROUTES = ["/mentorship"];

  it("has no OTHER requireUser()-gated route missing a matching disallow (the systematic check)", () => {
    const gatedRoutes = findRequireUserGatedRoutes(APP_DIR).filter(
      (route) => !KNOWN_DUAL_PURPOSE_ROUTES.includes(route),
    );
    // /mentorship/(list) and /mentorship/[mentorId] etc. all resolve under
    // /mentorship, which is DELIBERATELY not disallowed (send-385: it's now
    // a real, dual-purpose public/signed-in page) — its own sub-routes are
    // still covered by the "/mentorship/" prefix entry, which this check
    // still verifies for the ones with more path after /mentorship.
    const uncovered = gatedRoutes.filter((route) => !isCoveredByDisallow(route, disallow));
    expect(uncovered, `gated route(s) with no matching robots.ts disallow: ${uncovered.join(", ")}`).toEqual(
      [],
    );
  });

  it("does NOT disallow /mentorship itself — the one deliberate exception", () => {
    // The inverse mistake would be just as real: over-broadly disallowing
    // /mentorship would un-list the real public landing page send-385 built.
    expect(isCoveredByDisallow("/mentorship", disallow)).toBe(false);
  });
});
