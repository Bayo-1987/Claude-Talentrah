import { test, expect, type Page } from "@playwright/test";

/**
 * Cumulative Layout Shift on the public pages the owner's Lighthouse run flagged (S1-26 item 3): the whole page shifted because the cookie consent
 * banner was an in-flow block that only appeared after hydration. A first visit (no stored consent) is what is measured, because that is the visit
 * where the banner exists. Static pages only (/ and /about): the database-backed pages (/jobs, a job page) are left out so this spec needs no seed.
 *
 * Measured in the browser with the Layout Instability API, the same source Lighthouse reads. Shifts within 500 ms of a user input do not count
 * (hadRecentInput), and this spec makes no input. It names the shifting element in the failure message.
 */
const LIMIT = 0.1;

/**
 * Lighthouse measures on a throttled phone (4x CPU slowdown, slow 4G), where hydration finishes well after the first paint: that gap is exactly
 * where a banner that appears after hydration shifts the page. On a fast machine hydration can finish before the first paint and the shift never
 * registers, so this spec throttles the same way.
 */
async function throttleLikeLighthouse(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
}

async function cumulativeShift(page: Page, path: string): Promise<{ total: number; sources: string[] }> {
  await throttleLikeLighthouse(page);
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: { total: number; sources: string[] } };
    w.__cls = { total: 0, sources: [] };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean; sources?: Array<{ node?: Element }> }>) {
        if (entry.hadRecentInput) continue;
        w.__cls.total += entry.value;
        const n = entry.sources?.[0]?.node as Element | undefined;
        w.__cls.sources.push(`${entry.value.toFixed(3)} ${n ? `${n.tagName.toLowerCase()}${n.id ? "#" + n.id : ""}` : "?"}`);
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto(path, { waitUntil: "load" });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2500); // late shifts: banner after hydration, web fonts, streamed content
  return page.evaluate(() => (window as unknown as { __cls: { total: number; sources: string[] } }).__cls);
}

for (const width of [390, 1440]) {
  for (const route of ["/", "/about"]) {
    test(`${route} at ${width}px: first visit shifts at most ${LIMIT}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height: 800 }, isMobile: width < 640, hasTouch: width < 640 });
      const { total, sources } = await cumulativeShift(await context.newPage(), route);
      expect(total, `${route} CLS ${total.toFixed(3)}: ${sources.join(", ")}`).toBeLessThanOrEqual(LIMIT);
      await context.close();
    });
  }
}
