import { test, expect } from "@playwright/test";

/**
 * #585 — on the BUILT app (`next start`, as in CI), the self-hosted fonts behave like the `next/font/google` ones did:
 *  - the three preload hints on `/` point at exactly the URLs the stylesheets' @font-face rules use (a preload whose URL
 *    differs from the one the CSS fetches downloads the file twice and is reported unused);
 *  - those files are served `Cache-Control: public,max-age=31536000,immutable` (what production serves today for
 *    /_next/static/media/*.woff2, measured 2026-09-30);
 *  - the page asks no Google font host for anything.
 * tests/fonts/self-hosted-fonts.test.ts holds the source-level half of this; only a build shows the hashed URLs.
 */
test("the preloaded font files are the ones the stylesheets use, cached immutably, with no Google font request", async ({ page }) => {
  const googleRequests: string[] = [];
  page.on("request", (r) => {
    if (/fonts\.(googleapis|gstatic)\.com/.test(r.url())) googleRequests.push(r.url());
  });
  const fontResponses = new Map<string, { status: number; cacheControl: string | undefined }>();
  page.on("response", (r) => {
    if (/\.woff2(\?|$)/.test(r.url())) fontResponses.set(r.url(), { status: r.status(), cacheControl: r.headers()["cache-control"] });
  });

  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);

  const { preloads, fontFaceUrls } = await page.evaluate(() => {
    const preloads = [...document.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="font"]')].map((l) => l.href);
    const fontFaceUrls: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      for (const rule of Array.from(sheet.cssRules)) {
        if (!(rule instanceof CSSFontFaceRule)) continue;
        for (const m of rule.cssText.matchAll(/url\("?([^")]+)"?\)/g)) fontFaceUrls.push(new URL(m[1], sheet.href ?? location.href).href);
      }
    }
    return { preloads, fontFaceUrls };
  });

  expect(preloads, "the three latin files every page preloads").toHaveLength(3);
  expect(new Set(preloads).size).toBe(3);
  for (const href of preloads) {
    expect(fontFaceUrls, `${href} is preloaded but no @font-face uses that URL`).toContain(href);
    const res = fontResponses.get(href);
    expect(res, `${href} was not fetched`).toBeDefined();
    expect(res!.status).toBe(200);
    expect(res!.cacheControl).toMatch(/\bmax-age=31536000\b/);
    expect(res!.cacheControl).toMatch(/\bimmutable\b/);
    expect(res!.cacheControl).toMatch(/\bpublic\b/);
  }
  expect(googleRequests, "a request to a Google font host").toEqual([]);
});
