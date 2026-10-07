import { test, expect } from "@playwright/test";

/**
 * Cold-load layout shift on a throttled phone connection (QA-2, found by the QA session). Lighthouse's mobile profile (150 ms RTT, 1.6 Mbps, cache off) measured a
 * Cumulative Layout Shift of 0.162 on `/` and 0.179 on `/jobs` against production; "good" is under 0.1.
 *
 * WHAT CAUSED IT (measured, not guessed): not the webfonts. The fallback faces are already metric-matched (src/fonts/*.css), and with the cookie choice already stored
 * the same load shifts 0.0004 on `/` and 0.0000 on `/jobs`; the two font swaps are 0.0002 each. The shift was the cookie banner: it rendered only after hydration, so a
 * first-time visitor's page jumped down by the banner's height (147px on a phone) once the scripts ran. It is in the first paint now (see cookie-consent-banner.tsx), so
 * a first visit and a return visit measure the same.
 *
 * This is QA's spec (their local branch `qa/link-target-heights`), moved into the normal e2e config so CI runs it, unchanged in what it measures: a phone viewport, the
 * browser cache off, the network throttled with CDP, the shift summed from `layout-shift` entries without recent input. Signed out, public pages, no writes.
 */
for (const path of ["/", "/jobs"]) {
  test(`cold-load CLS < 0.1 on throttled mobile: ${path}`, async ({ browser }) => {
    test.setTimeout(60_000);
    const ctx = await browser.newContext({ viewport: { width: 412, height: 823 }, deviceScaleFactor: 1.75, isMobile: true });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: (1638 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });
    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
          if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto(path, { waitUntil: "load" });
    await page.waitForTimeout(3000);
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls, `CLS ${cls.toFixed(3)} on ${path}`).toBeLessThan(0.1);
    await ctx.close();
  });
}
