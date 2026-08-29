import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/types";

/**
 * The one-time hint that points at Farah.
 *
 * THE WHOLE POINT IS THAT IT POINTS AT THE RIGHT THING. The shell reaches
 * Farah three ways and which one exists depends on the viewport, so a hint
 * naming the wrong one is worse than no hint: it tells a first-time user to
 * look somewhere nothing is. Each breakpoint therefore asserts the SPECIFIC
 * sentence, not merely that a hint rendered.
 *
 * It also asserts the hint does not sit ON the panel it refers to. Two
 * positions were wrong before this one and both looked fine in a screenshot at
 * one width: `right-6` covered the panel outright, and a flat `right-[312px]`
 * cleared it at 1280 and overlapped by 56px at 1536, because the shell is
 * `max-w-[1360px]` and CENTRED — past 1360 a viewport-relative offset drifts
 * into the panel by exactly the margin. Hence five widths, and a real geometry
 * check rather than a visual one.
 */

const DEMO_PASSWORD = process.env.DEMO_PASSWORD;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

if (process.env.CI && !DEMO_PASSWORD) {
  throw new Error("farah-first-visit-hint spec cannot run in CI: DEMO_PASSWORD is not set");
}

const admin =
  SERVICE && SUPA_URL && !SERVICE.startsWith("PASTE")
    ? createClient<Database>(SUPA_URL, SERVICE, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;

/** Put the demo account back to "never seen it", so the hint renders at all. */
async function resetHint() {
  const { error } = await admin!
    .from("profiles")
    .update({ farah_hint_dismissed_at: null })
    .eq("email", "demo@talentrah.dev");
  // Checked: a refused Supabase update RESOLVES with an error rather than
  // throwing, and a silently-skipped reset would make every assertion below
  // pass or fail for the wrong reason.
  if (error) throw new Error(`could not reset the hint: ${error.message}`);
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo@talentrah.dev");
  await page.getByLabel("Password").fill(DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/jobs");
}

test.describe("the first-visit Farah hint", () => {
  test.skip(!DEMO_PASSWORD, "DEMO_PASSWORD is not set — see scripts/seed.ts");
  test.skip(!admin, "no usable SUPABASE_SERVICE_ROLE_KEY — this spec resets the flag it tests");

  test.beforeEach(resetHint);
  test.afterEach(resetHint);

  test("names the affordance that is actually on screen, at every width", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);

    /*
     * Expected sentence per width, keyed to the same breakpoints the
     * affordances use — 760 for the mobile bar, 2xl (1536) for the nav item.
     * `innerText` returns only VISIBLE text, so finding one variant is also
     * proof the other two are hidden rather than merely present.
     */
    const cases = [
      { width: 390, expect: "at the bottom of the screen", not: ["in the menu bar"] },
      { width: 1024, expect: "stays there as you scroll", not: ["at the bottom of the screen"] },
      { width: 1280, expect: "stays there as you scroll", not: ["in the menu bar"] },
      { width: 1536, expect: "in the menu bar", not: ["stays there as you scroll"] },
      { width: 1728, expect: "in the menu bar", not: ["at the bottom of the screen"] },
    ];

    for (const c of cases) {
      await page.setViewportSize({ width: c.width, height: 900 });
      await page.waitForTimeout(250);

      const hint = page.getByTestId("farah-first-visit-hint");
      await expect(hint, `no hint at ${c.width}px`).toBeVisible();

      const text = (await hint.innerText()).replace(/\s+/g, " ");
      expect(text, `wrong affordance named at ${c.width}px`).toContain(c.expect);
      for (const wrong of c.not) {
        expect(text, `${c.width}px also showed a variant meant for another width`).not.toContain(
          wrong,
        );
      }

      const geometry = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="farah-first-visit-hint"]')!;
        const panel = document.querySelector('[data-testid="farah-panel"]')!;
        const tab = document.querySelector('[data-testid="farah-mobile-tab"]') as HTMLElement | null;
        const b = el.getBoundingClientRect();
        const p = panel.getBoundingClientRect();
        const tabVisible = tab && getComputedStyle(tab).display !== "none";
        const t = tabVisible ? tab!.getBoundingClientRect() : null;
        return {
          zIndex: Number(getComputedStyle(el).zIndex),
          // Real 2-D overlap. A horizontal-only test reports a false positive
          // on a phone, where the panel is full-width but far below the fold.
          coversPanel:
            b.right > p.left && b.left < p.right && b.bottom > p.top && b.top < p.bottom,
          clearsTab: t ? b.bottom <= t.top : null,
          withinViewport: b.left >= 0 && b.right <= document.documentElement.clientWidth,
        };
      });

      expect(
        geometry.coversPanel,
        `at ${c.width}px the hint sits on the panel it is pointing at`,
      ).toBe(false);
      expect(geometry.withinViewport, `the hint is off screen at ${c.width}px`).toBe(true);
      // Above the bar (18), below the masthead band (20).
      expect(geometry.zIndex).toBeGreaterThan(18);
      expect(geometry.zIndex).toBeLessThan(20);
      if (geometry.clearsTab !== null) {
        expect(geometry.clearsTab, "the hint covers the bar it points at").toBe(true);
      }
    }
  });

  test("dismissing it is permanent, and survives a reload", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await login(page);

    const hint = page.getByTestId("farah-first-visit-hint");
    await expect(hint).toBeVisible();
    await hint.getByRole("button", { name: "Got it" }).click();

    // Optimistic: it goes on the click, not on the round trip.
    await expect(hint).toHaveCount(0);

    await expect(async () => {
      const { data } = await admin!
        .from("profiles")
        .select("farah_hint_dismissed_at")
        .eq("email", "demo@talentrah.dev")
        .single();
      expect(data?.farah_hint_dismissed_at, "the dismissal was never persisted").not.toBeNull();
    }).toPass({ timeout: 10_000 });

    // The server gate, not just the client one: a reload must not re-render it.
    await page.reload();
    await expect(page.getByTestId("farah-first-visit-hint")).toHaveCount(0);
  });

  test("'Show me' also dismisses, so following the hint counts as seeing it", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);

    const hint = page.getByTestId("farah-first-visit-hint");
    await expect(hint).toBeVisible();
    await hint.getByRole("button", { name: "Show me" }).click();
    await expect(hint).toHaveCount(0);

    // And it did what it said: the panel is on screen afterwards.
    await expect(async () => {
      const inView = await page.evaluate(() => {
        const p = document.querySelector('[data-testid="farah-panel"]')!.getBoundingClientRect();
        return p.top < window.innerHeight && p.bottom > 0;
      });
      expect(inView).toBe(true);
    }).toPass({ timeout: 20_000 });
  });
});
