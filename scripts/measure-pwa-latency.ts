/**
 * Measures navigation latency with and without the service worker, on a running production build:
 *
 *   E2E_BASE_URL=http://localhost:3000 npx tsx scripts/measure-pwa-latency.ts [rounds] [cpuRate]
 *
 * Three variants, measured INTERLEAVED (one navigation of each in turn, over many rounds), never all of one then all of the next, so drift on a
 * busy machine lands on all three equally:
 *   none     the browser blocks service workers for this context (no worker at all)
 *   nopre    the worker is installed and controls the page, navigation preload DISABLED
 *   preload  the worker is installed and controls the page, navigation preload ENABLED (what ships)
 * Each navigation is to a never-seen query string so nothing is served from a cache. Reported per URL: median and p90 of time-to-first-byte
 * (navigation responseStart, which includes the worker's start-up and fetch) and of the load event, in ms. cpuRate 4 turns on CDP CPU
 * throttling for the PAGE (Emulation.setCPUThrottlingRate); the worker runs in its own target, which that command does not slow, so a throttled
 * run understates the worker's own CPU cost, and says so in docs/pwa.md. The 1-minute load average is printed before and after.
 */
import os from "node:os";
import { chromium, type Page } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const ROUNDS = Number(process.argv[2] ?? 30);
const CPU = Number(process.argv[3] ?? 1);
const URLS = ["/about", "/employer"];
const VARIANTS = ["none", "nopre", "preload"] as const;
type Variant = (typeof VARIANTS)[number];

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

async function setup(browser: import("@playwright/test").Browser, variant: Variant) {
  const ctx = await browser.newContext({ baseURL: BASE, serviceWorkers: variant === "none" ? "block" : "allow" });
  const page = await ctx.newPage();
  await page.goto("/about");
  if (variant !== "none") {
    await page.waitForFunction(() => navigator.serviceWorker.getRegistrations().then(() => true), undefined, { timeout: 1000 }).catch(() => undefined);
    for (let i = 0; i < 80; i++) {
      const ready = await page.evaluate(async () => {
        const [r] = await navigator.serviceWorker.getRegistrations();
        return !!r?.active && !!navigator.serviceWorker.controller && (await r.navigationPreload.getState()).enabled;
      });
      if (ready) break;
      await page.waitForTimeout(250);
    }
    if (variant === "nopre") {
      await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations())[0].navigationPreload.disable());
      const state = await page.evaluate(async () => (await (await navigator.serviceWorker.getRegistrations())[0].navigationPreload.getState()).enabled);
      if (state) throw new Error("could not disable navigation preload");
    }
    // Navigations from here are controlled; confirm.
    await page.goto("/about?warm=1");
    if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) throw new Error(`${variant}: page is not controlled`);
  }
  if (CPU > 1) await (await ctx.newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: CPU });
  return { ctx, page };
}

async function timeNav(page: Page, url: string) {
  await page.goto(url, { waitUntil: "load" });
  return page.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    return { ttfb: n.responseStart - n.startTime, load: n.loadEventEnd - n.startTime };
  });
}

async function main() {
  const browser = await chromium.launch();
  const pages = {} as Record<Variant, Page>;
  const ctxs = [];
  for (const v of VARIANTS) {
    const s = await setup(browser, v);
    pages[v] = s.page;
    ctxs.push(s.ctx);
  }
  const loadBefore = os.loadavg()[0];
  const data: Record<string, Record<Variant, { ttfb: number[]; load: number[] }>> = {};
  for (const u of URLS) data[u] = { none: { ttfb: [], load: [] }, nopre: { ttfb: [], load: [] }, preload: { ttfb: [], load: [] } };
  for (let r = 0; r < ROUNDS; r++) {
    for (const u of URLS) {
      // Rotate who goes first each round so no variant always follows the same neighbour.
      const order = [...VARIANTS.slice(r % 3), ...VARIANTS.slice(0, r % 3)];
      for (const v of order) {
        const t = await timeNav(pages[v], `${u}?m=${v}-${r}`);
        data[u][v].ttfb.push(t.ttfb);
        data[u][v].load.push(t.load);
      }
    }
  }
  const loadAfter = os.loadavg()[0];
  console.log(`# cpuRate=${CPU} rounds=${ROUNDS} cores=${os.cpus().length} loadavg1 before=${loadBefore.toFixed(2)} after=${loadAfter.toFixed(2)}`);
  console.log("url | variant | n | ttfb median | ttfb p90 | load median | load p90   (ms)");
  const summary: Record<string, unknown> = {};
  for (const u of URLS) {
    for (const v of VARIANTS) {
      const d = data[u][v];
      const row = { n: d.ttfb.length, ttfbMed: pct(d.ttfb, 50), ttfbP90: pct(d.ttfb, 90), loadMed: pct(d.load, 50), loadP90: pct(d.load, 90) };
      summary[`${u} ${v}`] = row;
      console.log(`${u} | ${v} | ${row.n} | ${row.ttfbMed.toFixed(1)} | ${row.ttfbP90.toFixed(1)} | ${row.loadMed.toFixed(1)} | ${row.loadP90.toFixed(1)}`);
    }
  }
  console.log("JSON " + JSON.stringify({ cpuRate: CPU, rounds: ROUNDS, loadBefore, loadAfter, summary }));
  for (const c of ctxs) await c.close();
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
