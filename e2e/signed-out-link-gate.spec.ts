/**
 * send-477 — a standing regression net: a signed-out visitor must never be sent
 * to /login by an internal link on a public page.
 *
 * WHAT IT DOES. Fetches every sitemap URL plus a few seeds the sitemap does not
 * list (the not-found page, /login, /signup, /employer, /mentorship), with no
 * session. Collects every same-origin link on each, by region (masthead / main /
 * footer). Follows every distinct target hop by hop. Any target whose chain
 * passes through /login (or /admin/login) is a gated link, and is keyed
 * `region:page-group -> target` (see offenderKey in scripts/link-check.ts).
 *
 * THE RATCHET. The known offenders are tests/support/gated-link-allowlist.ts.
 *  - A gated link that is NOT in the allowlist fails: a new offender.
 *  - An allowlist row the crawl no longer sees fails: remove the row. (Only rows
 *    tagged coverage "ci" are enforced in CI — see the allowlist for why.)
 * So the list can only shrink. tests/marketing/gated-link-ratchet.test.tsx is the
 * fast, network-free half for the footer and the blog's related links.
 *
 * TWO CROSS-CHECKS keep it honest: live controls (a known-gated path MUST be seen
 * redirecting, a known-public one must not), and the gate function
 * (src/lib/auth/seeker-gate-paths.ts) must agree with what the server actually did
 * for every target — a disagreement means the function has drifted from proxy.ts.
 *
 * RUNS IN CI as part of the existing Playwright job, against the seeded local
 * stack, with no new secrets.
 *
 * MANUAL MODE — against production, on demand, never per PR and not in any
 * workflow — so rows tagged "prod-only" can be confirmed now and then:
 *
 *     npm run check-signed-out-links
 *     E2E_BASE_URL=https://staging.example npm run check-signed-out-links
 *
 * That sets LINK_GATE_SCOPE=all, which enforces every allowlist row, not just the
 * CI-reachable ones. It sends read-only, signed-out GETs (about 1,000 for the
 * current site), each identified as TalentrahLinkGate.
 *
 * KNOWN BLIND SPOTS: links that only exist after client-side state (the demo's
 * result panel), links added by JavaScript after load, and public pages that are
 * neither in the sitemap nor in SEEDS below.
 */
import { test, expect } from "@playwright/test";
import {
  classifyUrl,
  crawlSignedOutLinks,
  loginRedirectKind,
  parseSitemapUrls,
  type CrawlReport,
  type CrawlSource,
  type FetchLike,
} from "../scripts/link-check";
import { isProtectedSeekerPath } from "../src/lib/auth/seeker-gate-paths";
import {
  GATED_LINK_ALLOWLIST,
  enforcedForScope,
  ratchetDiff,
  type EnforcementScope,
} from "../tests/support/gated-link-allowlist";

/** `absoluteUrl()` writes the production origin into some hrefs; a CI server is on localhost. */
const PRODUCTION_ORIGINS = ["https://www.talentrah.com", "https://talentrah.com"];

/** Public pages the sitemap does not list. The 404 seed is what renders `not-found.tsx`. */
const SEEDS: CrawlSource[] = [
  { path: "/__link-gate-404__", group: "404" },
  { path: "/login" },
  { path: "/signup" },
  { path: "/employer" },
  { path: "/mentorship" },
];

const fetchLike: FetchLike = (url, init) => fetch(url, init);

function formatReport(scope: EnforcementScope, base: string, report: CrawlReport): string {
  const groups = Object.entries(report.groupCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([g, n]) => `${g}=${n}`)
    .join("  ");
  const lines = [
    `[signed-out-link-gate] ${base}  scope=${scope}`,
    `  sources fetched: ${report.sourcesFetched}   distinct targets followed: ${report.targets.length}   gated links: ${report.observations.length}`,
    `  sources per page group: ${groups}`,
  ];
  for (const o of report.observations) {
    const on = o.sourcePaths.length > 3 ? `${o.sourcePaths.slice(0, 3).join(", ")} … (${o.sourcePaths.length} pages)` : o.sourcePaths.join(", ");
    lines.push(`  ${o.key}   [${o.texts.slice(0, 3).join(" | ")}]   on ${on}`);
  }
  return lines.join("\n");
}

test("a signed-out visitor is never sent to /login by an internal link on a public page", async ({ baseURL }) => {
  test.setTimeout(240_000);
  const base = baseURL!;
  const scope: EnforcementScope = process.env.LINK_GATE_SCOPE === "all" ? "all" : "ci";

  // ── sources: the sitemap plus the seeds ───────────────────────────────────
  const sitemapRes = await fetch(new URL("/sitemap.xml", base), { redirect: "manual" });
  expect(sitemapRes.status, "sitemap.xml must be readable — without it there is nothing to crawl").toBe(200);
  const sitemapPaths = parseSitemapUrls(await sitemapRes.text()).map((u) => {
    const url = new URL(u);
    return url.pathname + url.search;
  });
  expect(sitemapPaths.length, "sitemap.xml parsed to zero URLs — a crawl of nothing would look clean").toBeGreaterThan(0);

  const seen = new Set<string>();
  const sources: CrawlSource[] = [{ path: "/" }, ...sitemapPaths.map((path) => ({ path })), ...SEEDS].filter((s) => {
    if (seen.has(s.path)) return false;
    seen.add(s.path);
    return true;
  });

  const report = await crawlSignedOutLinks({
    baseUrl: base,
    sources,
    fetchImpl: fetchLike,
    internalOrigins: PRODUCTION_ORIGINS,
    concurrency: 6,
    userAgent: "TalentrahLinkGate/1.0 (signed-out link check)",
  });
  // Printed on pass AND fail: on a first CI run this is how you learn what CI's data actually reaches.
  console.log(formatReport(scope, base, report));

  expect(
    report.sourceFailures,
    `these pages could not be read, so their links were not checked:\n${report.sourceFailures.map((f) => `  ${f.path}: ${f.problem}`).join("\n")}`,
  ).toEqual([]);

  // ── live controls: the check can see a redirect, and does not invent one ──
  const controlOpts = { timeoutMs: 20_000, userAgent: "TalentrahLinkGate/1.0 (signed-out link check)" };
  const gated = await classifyUrl(new URL("/tracker", base).toString(), fetchLike, controlOpts);
  expect(loginRedirectKind(gated), "control: /tracker must redirect a signed-out request to /login").toBe("login");
  const open = await classifyUrl(new URL("/scholarships/apply-now", base).toString(), fetchLike, controlOpts);
  expect(loginRedirectKind(open), "control: /scholarships/apply-now must NOT redirect a signed-out request").toBeNull();

  // ── the gate function must agree with what the server did ─────────────────
  // /admin has its own gate (proxy.ts adminGate → /admin/login) and is deliberately not part of
  // isProtectedSeekerPath, so an /admin target is excluded from this comparison. It is still
  // reported below as a gated link, keyed like any other, if a public page ever links to one.
  const disagreements = report.targets
    .filter((t) => !(t.pathname === "/admin" || t.pathname.startsWith("/admin/")))
    .filter((t) => isProtectedSeekerPath(t.pathname) !== (t.login === "login"))
    .map(
      (t) =>
        `  ${t.pathname}${t.search}: isProtectedSeekerPath says ${isProtectedSeekerPath(t.pathname) ? "gated" : "public"}, ` +
        `the server ${t.login === "login" ? "redirected to /login" : `did not (${t.kind})`}`,
    );
  expect(
    disagreements,
    "seeker-gate-paths.ts and the running server disagree — the path list has drifted from proxy.ts:\n" + disagreements.join("\n"),
  ).toEqual([]);

  // ── coverage: a row the crawl could not reach is not the same as a row whose link is gone ──
  const enforced = GATED_LINK_ALLOWLIST.filter((r) => enforcedForScope(r, scope));
  const unreached = enforced
    .map((r) => ({ row: r, group: r.key.match(/^main:(\S+) -> /)?.[1] }))
    .filter(({ group }) => group !== undefined && !report.groupCounts[group!])
    .map(({ row, group }) => `  ${row.key}: the crawl reached no page in group ${group}`);
  expect(
    unreached,
    "the crawl did not reach every kind of page the allowlist covers — it cannot vouch for these rows " +
      "(is seed data missing? do not add seeds to make this pass without deciding it deliberately):\n" +
      unreached.join("\n"),
  ).toEqual([]);

  // ── the ratchet ───────────────────────────────────────────────────────────
  const { fresh, stale } = ratchetDiff(
    report.observations.map((o) => o.key),
    scope,
  );
  const byKey = new Map(report.observations.map((o) => [o.key, o]));
  expect(
    fresh,
    "NEW links that send a signed-out visitor to /login. Point them at a public page (or make them session-aware); " +
      "do not add them to the allowlist unless a follow-up is genuinely assigned:\n" +
      fresh
        .map((k) => `  ${k}   [${byKey.get(k)!.texts.slice(0, 3).join(" | ")}]   found on ${byKey.get(k)!.sourcePaths.slice(0, 3).join(", ")}`)
        .join("\n"),
  ).toEqual([]);

  expect(
    stale,
    "STALE allowlist rows — the link is gone, so delete the row (the list may only shrink):\n" +
      stale.map((k) => `  ${k}`).join("\n"),
  ).toEqual([]);
});
