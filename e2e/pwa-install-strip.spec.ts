import { test, expect, admin } from "./fixtures/authed";
import type { Page } from "@playwright/test";
import { waitForWorkerControl } from "./support/pwa";
import { FARAH_FIRST_VISIT_HINT_TEST_ID } from "../src/lib/farah/first-visit-hint-id";

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
    test(`${label}: the content's top offset is the same before and after the strip mounts, and it does not sit on the Farah tab`, async ({ authedPage: page, testUser }) => {
      // The first-visit hint makes the strip wait on a phone (covered below); it is already dismissed here.
      await admin.from("profiles").update({ farah_hint_dismissed_at: new Date().toISOString() }).eq("id", testUser.id);
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

      // The strip is a bar on the bottom edge of the viewport at every width; on a phone the Farah launcher (a round button, no bottom bar any more) floats ABOVE it instead of on it.
      const box = (await strip(page).boundingBox())!;
      expect(Math.round(box.y + box.height), "strip bottom edge, below the content").toBeLessThanOrEqual(viewport.height);
      if (viewport.width < 760) {
        expect(Math.round(box.y + box.height), "on a phone the strip stands on the bottom edge").toBe(viewport.height);
        const launcher = (await page.getByTestId("farah-launcher").boundingBox())!;
        expect(launcher.y + launcher.height, "the launcher must not overlap the strip").toBeLessThanOrEqual(box.y + 1);
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
    await admin.from("profiles").update({ farah_hint_dismissed_at: new Date().toISOString() }).eq("id", testUser.id); // the phone-width hint makes the strip wait
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

/**
 * The fixed strip against everything else fixed, and against the end of the page (owner, 18 Oct). Widths 360 (a small phone), 768 (a tablet: the Farah column is beside the content) and 1280 (a desktop).
 * The only fixed floating controls this app has are the Farah tab below 760 px and Farah's first-visit hint; there is no bottom-right launcher on a desktop (the Farah panel is a column).
 */
test.describe("the strip against fixed controls and the end of the page", () => {
  const WIDTHS = [360, 768, 1280] as const;

  /** Bounding rect of every visible fixed-position element that is not the strip itself. */
  const fixedControls = (page: Page) =>
    page.evaluate(() => {
      const out: { name: string; top: number; bottom: number; left: number; right: number }[] = [];
      for (const el of document.querySelectorAll<HTMLElement>("body *")) {
        if (el.closest('[data-testid="install-strip"]')) continue;
        const cs = getComputedStyle(el);
        if (cs.position !== "fixed" || cs.display === "none" || cs.visibility === "hidden") continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        out.push({ name: el.getAttribute("data-testid") ?? el.tagName.toLowerCase() + "." + el.className.toString().slice(0, 30), top: r.top, bottom: r.bottom, left: r.left, right: r.right });
      }
      return out;
    });

  for (const width of WIDTHS) {
    test(`${width}px: the strip's buttons overlap no fixed control, and the last content of a long page ends above the strip`, async ({ authedPage: page, testUser }) => {
      // The first-visit hint is its own test below; this one has it already dismissed so only the standing controls are measured.
      await admin.from("profiles").update({ farah_hint_dismissed_at: new Date().toISOString() }).eq("id", testUser.id);
      await page.setViewportSize({ width, height: 800 });
      await page.addInitScript(CONSENTED);
      await page.goto("/jobs");
      await waitForWorkerControl(page);
      await firePrompt(page);
      await expect(strip(page)).toBeVisible();
      await page.waitForTimeout(300);

      // A long page: the feed's own height, scrolled to the very end.
      expect(await page.evaluate(() => document.documentElement.scrollHeight), "the page must be long enough to scroll").toBeGreaterThan(1200);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(200);

      const bar = (await strip(page).boundingBox())!;
      const buttons = [await page.getByRole("button", { name: "Install" }).boundingBox(), await page.getByRole("button", { name: "Not now" }).boundingBox()].map((b) => b!);
      const overlaps = (a: { x: number; y: number; width: number; height: number }, b: { left: number; right: number; top: number; bottom: number }) =>
        a.x < b.right && a.x + a.width > b.left && a.y < b.bottom && a.y + a.height > b.top;
      const controls = await fixedControls(page);
      for (const c of controls) for (const b of buttons) expect(overlaps(b, c), `a strip button overlaps the fixed control ${c.name}`).toBe(false);
      // On a phone the Farah launcher is there (and the strip stands under it, not on it).
      if (width < 760) {
        expect(controls.some((c) => c.name.includes("farah") || c.bottom >= 800 - 1), "the Farah launcher is among the fixed controls on a phone").toBe(true);
      }

      // The last piece of CONTENT on the page, with the page scrolled to its end, must end above the strip's top edge: nothing is hidden under the bar. "Content" is an element that
      // carries text of its own or is media or a control; wrappers, spacers and the reserve under the Farah tab are not content (they end at the document's end by design).
      const lastBottom = await page.evaluate(() => {
        const MEDIA = new Set(["IMG", "SVG", "CANVAS", "VIDEO", "INPUT", "TEXTAREA", "SELECT", "BUTTON", "HR"]);
        let max = 0;
        for (const el of document.querySelectorAll<HTMLElement>("body *")) {
          const cs = getComputedStyle(el);
          if (cs.position === "fixed" || cs.display === "none" || cs.visibility === "hidden") continue;
          if (el.closest('[data-testid="install-strip"], [data-testid="install-strip-spacer"], [aria-hidden="true"], script, style')) continue;
          if (el.closest("[style*='position: fixed'], .fixed")) continue;
          const ownText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? "").trim() !== "");
          if (!ownText && !MEDIA.has(el.tagName.toUpperCase())) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          max = Math.max(max, r.bottom);
        }
        return max;
      });
      expect(lastBottom, "the lowest content bottom, page scrolled to the end").toBeLessThanOrEqual(bar.y + 0.5);
    });
  }

  test("on a phone there is no first-visit hint, so the strip is never held back by one; it appears at once", async ({ authedPage: page }) => {
    // Launcher plan Q4: the phone variant of the hint is retired and the card leaves the page below 760px, which is what lets the strip show. (The strip still waits for the hint at its other
    // widths only if the hint overlaps it, which it cannot: from 760px the hint sits beside the panel. That rule is exercised by the "live" test below with an injected hint.)
    await page.setViewportSize({ width: 360, height: 800 });
    await page.addInitScript(CONSENTED);
    await page.goto("/jobs");
    await waitForWorkerControl(page);
    await expect(page.getByTestId("farah-first-visit-hint")).toHaveCount(0);
    await firePrompt(page);
    await expect(strip(page)).toBeVisible();
  });
});

test("live, on a phone: the strip is showing, the hint appears (nested) so it hides, the hint goes so it comes back; unrelated DOM churn changes nothing", async ({ authedPage: page, testUser }) => {
  await admin.from("profiles").update({ farah_hint_dismissed_at: new Date().toISOString() }).eq("id", testUser.id); // no real hint: the test adds and removes one
  await page.setViewportSize({ width: 360, height: 800 });
  await page.addInitScript(CONSENTED);
  await page.goto("/jobs");
  await waitForWorkerControl(page);
  await firePrompt(page);
  await expect(strip(page)).toBeVisible();

  // A burst of unrelated DOM changes: the strip stays, untouched.
  await page.evaluate(() => {
    for (let i = 0; i < 200; i++) {
      const d = document.createElement("div");
      d.textContent = `churn ${i}`;
      document.body.appendChild(d);
      d.remove();
    }
  });
  await page.waitForTimeout(300);
  await expect(strip(page)).toBeVisible();

  // A hint added INSIDE a nested element (not a direct child of body): the strip hides.
  await page.evaluate((id) => {
    const outer = document.createElement("section");
    outer.id = "s4-outer";
    const inner = document.createElement("div");
    const hint = document.createElement("div");
    hint.setAttribute("data-testid", id);
    inner.appendChild(hint);
    outer.appendChild(inner);
    document.body.appendChild(outer);
  }, FARAH_FIRST_VISIT_HINT_TEST_ID);
  await expect(strip(page)).toHaveCount(0);

  // Removing the whole wrapper (the hint goes with its subtree): the strip comes back.
  await page.evaluate(() => document.getElementById("s4-outer")!.remove());
  await expect(strip(page)).toBeVisible();
});

test("from 760px up the hint sits beside the panel, so the strip does not wait for it and the two do not overlap", async ({ authedPage: page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(CONSENTED);
  await page.goto("/jobs");
  await waitForWorkerControl(page);
  await expect(page.getByTestId("farah-first-visit-hint")).toBeVisible();
  await firePrompt(page);
  await expect(strip(page)).toBeVisible();
  const a = (await strip(page).boundingBox())!;
  const b = (await page.getByTestId("farah-first-visit-hint").boundingBox())!;
  expect(a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y, "the strip and the hint overlap").toBe(false);
});

test.describe("'Not now' persists", () => {
  test("across pages and reloads in this browser (a 30-day timestamp in localStorage)", async ({ authedPage: page }) => {
    await page.addInitScript(CONSENTED);
    await page.goto("/jobs");
    await waitForWorkerControl(page);
    await firePrompt(page);
    await expect(strip(page)).toBeVisible();
    await page.getByRole("button", { name: "Not now" }).click();
    const stamp = await page.evaluate(() => localStorage.getItem("talentrah-install-dismissed"));
    expect(Number(stamp)).toBeGreaterThan(Date.now() - 60_000);

    for (const path of ["/tracker", "/settings", "/jobs"]) {
      await page.goto(path); // a full load of another signed-in page
      await firePrompt(page);
      await page.waitForTimeout(500);
      await expect(strip(page), `still dismissed on ${path}`).toHaveCount(0);
    }
    await page.reload();
    await firePrompt(page);
    await page.waitForTimeout(500);
    await expect(strip(page)).toHaveCount(0);

    // Thirty-one days later it is offered again.
    await page.evaluate(() => localStorage.setItem("talentrah-install-dismissed", String(Date.now() - 31 * 24 * 60 * 60 * 1000)));
    await page.reload();
    await firePrompt(page);
    await expect(strip(page)).toBeVisible();
  });
});
