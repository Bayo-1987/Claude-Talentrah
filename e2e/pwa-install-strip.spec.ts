import { test, expect } from "./fixtures/authed";
import type { Page } from "@playwright/test";
import { waitForWorkerControl } from "./support/pwa";

/**
 * The install strip in a real browser (design note test 12). Chromium never offers an install prompt in automation, so the specs dispatch a
 * `beforeinstallprompt`-shaped event themselves; what is real is everything the strip does with it.
 */

const CONSENTED = () => localStorage.setItem("talentrah-cookie-consent", "accepted");

/** Dispatches a prompt-shaped event on window and counts prompt() calls in window.__promptCalls. */
async function firePrompt(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __promptCalls?: number };
    w.__promptCalls = 0;
    const ev = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: () => {
        w.__promptCalls = (w.__promptCalls ?? 0) + 1;
        return Promise.resolve();
      },
      userChoice: Promise.resolve({ outcome: "accepted" as const }),
    });
    window.dispatchEvent(ev);
  });
}

const strip = (page: Page) => page.getByTestId("install-strip");

test.describe("Android / Chromium", () => {
  test("appears in the signed-in shell after the prompt, Install calls prompt() once, and the strip goes", async ({ authedPage: page }) => {
    await page.addInitScript(CONSENTED);
    await page.goto("/jobs");
    await waitForWorkerControl(page); // the bootstrap has run (it registers the worker)
    await expect(strip(page)).toHaveCount(0);

    await firePrompt(page);
    await expect(strip(page)).toBeVisible();
    await expect(strip(page)).toContainText("Add Talentrah to your home screen.");

    await page.getByRole("button", { name: "Install" }).click();
    await expect(strip(page)).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __promptCalls: number }).__promptCalls)).toBe(1);
  });

  test("a prompt that fired BEFORE the lazy strip loaded is not lost", async ({ authedPage: page }) => {
    await page.addInitScript(CONSENTED);
    // Hold back the chunk that contains the strip until the prompt has been fired.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await page.route("**/_next/static/**/*.js", async (route) => {
      try {
        const response = await route.fetch();
        const body = await response.body();
        if (body.includes("talentrah-install-dismissed")) await gate;
        await route.fulfill({ response, body });
      } catch {
        await route.fallback().catch(() => undefined);
      }
    });
    await page.goto("/jobs");
    await waitForWorkerControl(page);
    await firePrompt(page); // the early bootstrap keeps it; the strip is not mounted yet
    await expect(strip(page)).toHaveCount(0);
    release();
    await expect(strip(page)).toBeVisible();
    await page.getByRole("button", { name: "Install" }).click();
    expect(await page.evaluate(() => (window as unknown as { __promptCalls: number }).__promptCalls)).toBe(1);
  });

  test("Not now hides it and it stays hidden after a reload; hit targets are at least 40 by 40", async ({ authedPage: page }) => {
    await page.addInitScript(CONSENTED);
    await page.goto("/jobs");
    await waitForWorkerControl(page);
    await firePrompt(page);
    await expect(strip(page)).toBeVisible();
    for (const name of ["Install", "Not now"]) {
      const box = await page.getByRole("button", { name }).boundingBox();
      expect(box!.width, `${name} width`).toBeGreaterThanOrEqual(40);
      expect(box!.height, `${name} height`).toBeGreaterThanOrEqual(40);
    }
    await page.getByRole("button", { name: "Not now" }).click();
    await expect(strip(page)).toHaveCount(0);

    await page.reload();
    await waitForWorkerControl(page);
    await firePrompt(page);
    await page.waitForTimeout(800);
    await expect(strip(page)).toHaveCount(0);
  });

  test("still renders when storage throws (private window)", async ({ authedPage: page }) => {
    await page.addInitScript(() => {
      const real = Storage.prototype.getItem;
      Storage.prototype.getItem = function (k: string) {
        if (k === "talentrah-cookie-consent") return "accepted";
        throw new Error("SecurityError");
      };
      void real;
      Storage.prototype.setItem = () => {
        throw new Error("QuotaExceededError");
      };
      document.documentElement.setAttribute("data-cookie-consent", "decided");
    });
    await page.goto("/jobs");
    await waitForWorkerControl(page);
    await firePrompt(page);
    await expect(strip(page)).toBeVisible();
    await page.getByRole("button", { name: "Not now" }).click(); // the write throws; nothing may break
    await expect(strip(page)).toHaveCount(0);
  });
});

test.describe("the strip must not cost the page its server HTML", () => {
  test("a signed-in page's server HTML is not discarded for client rendering by the lazy strip", async ({ authedPage: page }) => {
    // next/dynamic(ssr:false) bails out to client rendering at the nearest Suspense boundary: the whole signed-in page's server HTML is thrown away and rebuilt
    // in the browser, so it hydrates late (e2e/credit-prices.spec.ts then clicked before the page was alive). The marker is in the HTML the server sends.
    for (const path of ["/jobs", "/tracker", "/settings"]) {
      const html = await (await page.request.get(path)).text();
      expect(html, `${path} must be server-rendered`).not.toContain("BAILOUT_TO_CLIENT_SIDE_RENDERING");
    }
  });
});

test.describe("the strip does not move the page", () => {
  for (const [label, viewport] of [["phone", { width: 390, height: 844 }], ["desktop", { width: 1280, height: 900 }]] as const) {
    test(`${label}: the content's top offset is the same before and after the strip mounts, and it does not sit on the Farah tab`, async ({ authedPage: page }) => {
      await page.setViewportSize(viewport);
      await page.addInitScript(CONSENTED);
      await page.goto("/jobs");
      await waitForWorkerControl(page);
      await expect(strip(page)).toHaveCount(0);

      const column = page.getByTestId("content-column");
      const top = async () => (await column.evaluate((el) => el.getBoundingClientRect().top + window.scrollY));
      const mastheadBottom = async () => page.getByTestId("masthead-band").evaluate((el) => el.getBoundingClientRect().bottom + window.scrollY);
      const before = { top: await top(), masthead: await mastheadBottom() };

      await firePrompt(page);
      await expect(strip(page)).toBeVisible();
      await page.waitForTimeout(300); // let any layout settle: a shift would show by now

      expect(await top(), "content column top after the strip mounted").toBe(before.top);
      expect(await mastheadBottom(), "masthead bottom after the strip mounted").toBe(before.masthead);

      // The strip is a bar on the bottom edge of the viewport; on a phone it stands above the Farah tab instead of on it.
      const box = (await strip(page).boundingBox())!;
      expect(Math.round(box.y + box.height), "strip bottom edge, below the content").toBeLessThanOrEqual(viewport.height);
      if (viewport.width < 760) {
        const tab = (await page.getByRole("button", { name: /Ask Farah/ }).last().boundingBox())!;
        expect(box.y + box.height, "strip bottom must not overlap the Farah tab").toBeLessThanOrEqual(tab.y + 1);
      }

      // And it leaves again without moving anything.
      await page.getByRole("button", { name: "Not now" }).click();
      await expect(strip(page)).toHaveCount(0);
      expect(await top()).toBe(before.top);
    });
  }
});

test.describe("where it must not show", () => {
  test("never under the cookie banner: hidden while it is open, offered once a choice is made", async ({ authedPage: page }) => {
    await page.goto("/jobs");
    await expect(page.getByTestId("cookie-consent-banner")).toBeVisible();
    await waitForWorkerControl(page);
    await firePrompt(page);
    await page.waitForTimeout(800);
    await expect(strip(page)).toHaveCount(0);

    await page.getByRole("button", { name: "Accept" }).click();
    await expect(strip(page)).toBeVisible();
  });

  test("not on a public marketing page, even signed in, and not for a signed-out visitor", async ({ authedPage: page, browser, baseURL }) => {
    await page.addInitScript(CONSENTED);
    await page.goto("/about");
    await waitForWorkerControl(page);
    await firePrompt(page);
    await page.waitForTimeout(800);
    await expect(strip(page)).toHaveCount(0);

    const signedOut = await browser.newContext({ baseURL });
    const p = await signedOut.newPage();
    await p.addInitScript(CONSENTED);
    for (const path of ["/", "/jobs"]) {
      await p.goto(path);
      await waitForWorkerControl(p);
      await firePrompt(p);
      await p.waitForTimeout(800);
      await expect(strip(p), `signed-out ${path}`).toHaveCount(0);
    }
    await signedOut.close();
  });

  test("not when the app is already installed (standalone display mode)", async ({ authedPage: page }) => {
    // Chromium cannot be switched into standalone display mode from automation (CDP's media emulation ignores display-mode), so the media query
    // is answered the way an installed app answers it; the strip's own code reads it through the real matchMedia API.
    await page.addInitScript(() => {
      localStorage.setItem("talentrah-cookie-consent", "accepted");
      const real = window.matchMedia.bind(window);
      window.matchMedia = (q: string) => (q === "(display-mode: standalone)" ? ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } as unknown as MediaQueryList) : real(q));
    });
    await page.goto("/jobs");
    await waitForWorkerControl(page);
    await firePrompt(page);
    await page.waitForTimeout(800);
    await expect(strip(page)).toHaveCount(0);
  });
});

test.describe("iOS Safari", () => {
  test("shows how to install, and offers no Install button", async ({ browser, baseURL, testUser, authedPage }) => {
    // Reuse the signed-in cookie in an iPhone-Safari-shaped context.
    const cookies = await authedPage.context().cookies();
    const ctx = await browser.newContext({
      baseURL,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
      viewport: { width: 390, height: 844 },
    });
    await ctx.addCookies(cookies);
    const p = await ctx.newPage();
    await p.addInitScript(CONSENTED);
    await p.goto("/jobs");
    await expect(strip(p)).toBeVisible();
    await expect(strip(p)).toContainText("To install: tap Share, then Add to Home Screen.");
    await expect(p.getByRole("button", { name: "Install" })).toHaveCount(0);
    void testUser;
    await ctx.close();
  });
});
