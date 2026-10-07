/**
 * Per-route payload budget (owner, 7 Oct 2026): a page must not get heavier without somebody choosing to let it, and the check has to fail BEFORE merge.
 *
 * WHY THIS EXISTS NEXT TO scripts/check-bundle-size.ts. That script (a step of the required `checks` job) measures the one thing an HTTP-only client can see: the hydration-critical
 * `<script src>` tags in the HTML, gzip, for three routes. It cannot see what a BROWSER downloads after hydration: the 88 KB the router's prefetch of the home route pulled into /blog (the
 * Supabase auth client) was invisible to it, as are fonts, CSS, the number of requests, and any new third-party script. This spec loads each public route the way a first-time mobile visitor
 * does and holds those to e2e/support/payload-budgets.json.
 *
 * HOW IT STAYS DETERMINISTIC AND OFFLINE. Every request to another origin is fulfilled with an empty body and COUNTED (so a new third-party script fails without any network and the run
 * never depends on Google being reachable); the own-origin bytes are gzip level 9 of each response body (the same unit as check-bundle-size.ts, and `next start` does not compress), taken with
 * the browser cache off. Budgets are the measured number plus about 5 %: change one on purpose by editing the JSON in the same PR (it shows in review); the failure message prints the table.
 *
 * Runs inside the existing required "Playwright e2e" check (no workflow change). Re-measure with: PAYLOAD_MEASURE=1 npx playwright test e2e/route-payload-budget.spec.ts
 * (it prints one JSON line per route and asserts nothing).
 */
import { test, expect, type Browser } from "@playwright/test";
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface RouteBudget {
  totalKB: number;
  jsKB: number;
  fontKB: number;
  requests: number;
  /** The exact set of other origins the page asks for (they are never fetched here). */
  thirdParty: string[];
}
const FILE = join(__dirname, "support/payload-budgets.json");
const BUDGETS: { routes: Record<string, RouteBudget> } = JSON.parse(readFileSync(FILE, "utf8"));
const MEASURE_ONLY = process.env.PAYLOAD_MEASURE === "1";
const SETTLE_MS = 3500; // the router's prefetches and the chunks they trigger start after hydration; "nothing more loads" has no event to wait for

interface Measured extends Omit<RouteBudget, "thirdParty"> {
  thirdParty: string[];
}

async function measure(browser: Browser, baseURL: string, path: string): Promise<Measured> {
  const own = new URL(baseURL).origin;
  const ctx = await browser.newContext({ baseURL, viewport: { width: 412, height: 823 }, deviceScaleFactor: 1.75, isMobile: true });
  const other = new Set<string>();
  await ctx.route("**/*", (route) => {
    const origin = new URL(route.request().url()).origin;
    if (origin === own) return route.continue();
    other.add(origin);
    return route.fulfill({ status: 200, body: "" });
  });
  let total = 0;
  let js = 0;
  let font = 0;
  let requests = 0;
  const pending: Array<Promise<void>> = [];
  ctx.on("response", (res) => {
    if (new URL(res.url()).origin !== own) return;
    requests++;
    pending.push(
      res
        .body()
        .then((body) => {
          const bytes = Math.min(body.length, gzipSync(body, { level: 9 }).length);
          total += bytes;
          const type = res.request().resourceType();
          if (type === "script") js += bytes;
          if (type === "font") font += bytes;
        })
        .catch(() => {}), // a redirect has no body
    );
  });
  const page = await ctx.newPage();
  await page.goto(path, { waitUntil: "load" });
  await page.waitForTimeout(SETTLE_MS);
  await Promise.all(pending);
  await ctx.close();
  const kb = (n: number) => Math.round((n / 1024) * 10) / 10;
  return { totalKB: kb(total), jsKB: kb(js), fontKB: kb(font), requests, thirdParty: [...other].sort() };
}

for (const [route, budget] of Object.entries(BUDGETS.routes)) {
  test(`payload: ${route}`, async ({ browser, baseURL, request }) => {
    let path = route;
    if (route === "job-detail") {
      const sitemap = await (await request.get("/sitemap.xml")).text();
      const id = /\/jobs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(sitemap)?.[1];
      test.skip(!id, "no job posting is listed in this environment's sitemap");
      path = `/jobs/${id}`;
    }
    const m = await measure(browser, baseURL!, path);
    if (MEASURE_ONLY) {
      console.log(`PAYLOAD_MEASURED ${JSON.stringify({ route, ...m })}`);
      return;
    }
    const problems: string[] = [];
    const over = (what: string, got: number, max: number) => {
      if (got > max) problems.push(`${what}: ${got} (budget ${max}, +${Math.round(((got - max) / max) * 100)} %)`);
    };
    over("total KB (gzip, own origin)", m.totalKB, budget.totalKB);
    over("JS KB", m.jsKB, budget.jsKB);
    over("font KB", m.fontKB, budget.fontKB);
    over("requests", m.requests, budget.requests);
    if (JSON.stringify(m.thirdParty) !== JSON.stringify([...budget.thirdParty].sort())) {
      problems.push(`other origins asked for: [${m.thirdParty.join(", ")}] (budget: [${budget.thirdParty.join(", ")}])`);
    }
    expect(
      problems,
      `${route} is over its payload budget (e2e/support/payload-budgets.json). If the growth is intended, change the budget in the same PR and say why.\n` +
        `measured: ${JSON.stringify(m)}`,
    ).toEqual([]);
  });
}
