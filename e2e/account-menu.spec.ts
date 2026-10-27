import { test, expect, type Page } from "@playwright/test";
import { buildHarnessHtml } from "./support/account-menu-harness/build";

/**
 * The account menu behind the avatar, in the seeker header and in the employer header. Both headers are the REAL components (see support/account-menu-harness/entry.tsx), mounted in a blank
 * document with the app's real compiled stylesheet, so layout, focus and keyboard behaviour are what a browser really does; only next/link, next/navigation and the sign-out Server Action are
 * stubbed (a link records where it would go, the action counts its calls). No app server and no database are needed.
 *
 * The seeker block is the BASELINE: it was written and run green against the header as it was before the menu became a shared component, and must stay green after. The employer block
 * is the new behaviour: no loose "Sign out" link, the avatar is a button that opens the same menu.
 */
const SEEKER = { creditsBalance: 5, activePass: null, initials: "SH", email: "sam.hall@example.test", displayName: "Sam Hall" };
const EMPLOYER = { orgInitials: "ST", orgName: "Stonebridge Talent", email: "owner@stonebridge.test", displayName: "Sam Owner", userInitials: "SO" };

let html = "";
test.beforeAll(async () => {
  html = await buildHarnessHtml();
});

async function mount(page: Page, kind: "seeker" | "employer", props: Record<string, unknown>, width = 1280) {
  await page.setViewportSize({ width, height: 800 });
  await page.setContent(html);
  await page.evaluate(([k, p]) => window.__mount(k as "seeker" | "employer", p as Record<string, unknown>), [kind, props] as const);
}
const trigger = (page: Page) => page.getByRole("button", { name: "Account menu" });
const menu = (page: Page) => page.getByRole("menu");
const signOuts = (page: Page) => page.evaluate(() => window.__signOuts);
const navigated = (page: Page) => page.evaluate(() => window.__navigated);

for (const kind of ["seeker", "employer"] as const) {
  const props = kind === "seeker" ? SEEKER : EMPLOYER;
  // The seeker block is the baseline; the employer block holds the same contract for the new menu. Same assertions, so "the same pattern" is checked, not described.
  test.describe(`${kind} header: the avatar opens the account menu`, () => {
    test("the avatar is one button with an accessible name; aria-haspopup is menu and aria-expanded follows the menu", async ({ page }) => {
      await mount(page, kind, props);
      await expect(trigger(page)).toHaveCount(1);
      await expect(trigger(page)).toHaveAttribute("aria-haspopup", "menu");
      await expect(trigger(page)).toHaveAttribute("aria-expanded", "false");
      await expect(menu(page)).toHaveCount(0);
      await trigger(page).click();
      await expect(trigger(page)).toHaveAttribute("aria-expanded", "true");
      await expect(menu(page)).toHaveCount(1);
      await trigger(page).click();
      await expect(trigger(page)).toHaveAttribute("aria-expanded", "false");
      await expect(menu(page)).toHaveCount(0);
    });

    test("the menu shows the signed-in user's name and email, then Settings, then Sign out", async ({ page }) => {
      await mount(page, kind, props);
      await trigger(page).click();
      const text = (await menu(page).innerText()).split("\n").map((l) => l.trim()).filter(Boolean);
      expect(text).toEqual([props.displayName, props.email, "Settings", "Sign out"]);
      await expect(menu(page).getByRole("menuitem")).toHaveText(["Settings", "Sign out"]);
      await expect(menu(page).getByRole("menuitem", { name: "Settings" })).toHaveAttribute("href", "/settings");
    });

    test("Enter opens it and Space opens it; opening moves focus to the first item", async ({ page }) => {
      await mount(page, kind, props);
      for (const key of ["Enter", "Space"]) {
        await trigger(page).focus();
        await page.keyboard.press(key);
        await expect(menu(page)).toHaveCount(1);
        await expect(menu(page).getByRole("menuitem", { name: "Settings" })).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(menu(page)).toHaveCount(0);
      }
    });

    test("Escape closes it and returns focus to the avatar button", async ({ page }) => {
      await mount(page, kind, props);
      await trigger(page).click();
      await page.keyboard.press("Escape");
      await expect(menu(page)).toHaveCount(0);
      await expect(trigger(page)).toBeFocused();
      await expect(trigger(page)).toHaveAttribute("aria-expanded", "false");
    });

    test("Tab moves through the items in order, and Shift+Tab back", async ({ page }) => {
      await mount(page, kind, props);
      await trigger(page).click();
      await expect(menu(page).getByRole("menuitem", { name: "Settings" })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(menu(page).getByRole("menuitem", { name: "Sign out" })).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(menu(page).getByRole("menuitem", { name: "Settings" })).toBeFocused();
    });

    test("a click outside closes it and focus goes back to the avatar button", async ({ page }) => {
      await mount(page, kind, props);
      await trigger(page).click();
      await page.mouse.click(40, 400);
      await expect(menu(page)).toHaveCount(0);
      await expect(trigger(page)).toBeFocused();
    });

    test("Sign out runs the sign-out action once; Settings goes to /settings and closes the menu", async ({ page }) => {
      await mount(page, kind, props);
      await trigger(page).click();
      await menu(page).getByRole("menuitem", { name: "Sign out" }).click();
      expect(await signOuts(page)).toBe(1);

      await mount(page, kind, props);
      await trigger(page).click();
      await menu(page).getByRole("menuitem", { name: "Settings" }).click();
      expect(await navigated(page)).toEqual(["/settings"]);
      await expect(menu(page)).toHaveCount(0);
      expect(await signOuts(page)).toBe(0);
    });

    test("with no name the menu shows the email alone; with neither there is no empty identity row", async ({ page }) => {
      await mount(page, kind, { ...props, displayName: "" });
      await trigger(page).click();
      expect((await menu(page).innerText()).split("\n").map((l) => l.trim()).filter(Boolean)).toEqual([props.email, "Settings", "Sign out"]);

      if (kind === "employer") {
        await mount(page, kind, { ...props, displayName: "", email: "" });
        await trigger(page).click();
        expect((await menu(page).innerText()).split("\n").map((l) => l.trim()).filter(Boolean)).toEqual(["Settings", "Sign out"]);
        const empty = await menu(page).evaluate((m) => [...m.children].filter((c) => !c.textContent?.trim() && c.children.length === 0 && c.getBoundingClientRect().height > 1).length);
        expect(empty, "an empty padded row in the menu").toBe(0);
      }
    });

    test("the email is never put in an address, a link or the console", async ({ page }) => {
      const logs: string[] = [];
      page.on("console", (m) => logs.push(m.text()));
      await mount(page, kind, props);
      await trigger(page).click();
      await menu(page).getByRole("menuitem", { name: "Settings" }).click();
      expect(page.url()).not.toContain("@");
      expect(JSON.stringify(await navigated(page))).not.toContain("@");
      const hrefs = await page.evaluate(() => [...document.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? ""));
      expect(hrefs.join(" ")).not.toContain("@");
      expect(logs.join(" ")).not.toContain(String(props.email));
    });

    test("the menu works at phone width: it stays inside the screen, and the avatar button and every item are at least as large as the kind's tap-target rule", async ({ page }) => {
      await mount(page, kind, props, 375);
      const min = kind === "employer" ? 44 : 40; // seeker: 40 as before (CLAUDE.md); employer: 44
      const b = (await trigger(page).boundingBox())!;
      expect(b.width).toBeGreaterThanOrEqual(min);
      expect(b.height).toBeGreaterThanOrEqual(min);
      await trigger(page).click();
      const m = (await menu(page).boundingBox())!;
      expect(m.x).toBeGreaterThanOrEqual(0);
      expect(m.x + m.width).toBeLessThanOrEqual(375);
      for (const item of await menu(page).getByRole("menuitem").all()) {
        const r = (await item.boundingBox())!;
        expect(r.height).toBeGreaterThanOrEqual(min);
        expect(r.width).toBeGreaterThanOrEqual(min);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    });

    test("keyboard focus on the avatar button is visible", async ({ page }) => {
      await mount(page, kind, props);
      for (let i = 0; i < 20; i++) {
        await page.keyboard.press("Tab");
        if (await trigger(page).evaluate((el) => el === document.activeElement)) break;
      }
      await expect(trigger(page)).toBeFocused();
      const ring = await trigger(page).evaluate((el) => {
        const s = getComputedStyle(el);
        return { visible: el.matches(":focus-visible"), style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
      });
      expect(ring.visible).toBe(true);
      expect(ring.style).not.toBe("none");
      expect(ring.width).toBeGreaterThan(0);
    });
  });
}

test.describe("seeker header: the look is as it was", () => {
  test("the avatar is a 34px circle in a 40px button, the menu is 248px wide and right-aligned to the button", async ({ page }) => {
    await mount(page, "seeker", SEEKER);
    const b = (await trigger(page).boundingBox())!;
    expect([b.width, b.height]).toEqual([40, 40]);
    const circle = await trigger(page).locator("span").first().evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height, radius: getComputedStyle(el).borderRadius, text: el.textContent };
    });
    expect(circle).toMatchObject({ w: 34, h: 34, text: "SH" });
    expect(parseFloat(circle.radius)).toBeGreaterThanOrEqual(17);
    await trigger(page).click();
    const m = (await menu(page).boundingBox())!;
    expect(m.width).toBe(248);
    expect(Math.round(m.x + m.width)).toBe(Math.round(b.x + b.width));
  });
});

test.describe("employer header: the menu replaces the loose Sign out link", () => {
  test("there is no Sign out link or button in the bar, and \"Looking for work?\" stays before the avatar", async ({ page }) => {
    await mount(page, "employer", EMPLOYER);
    await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Sign out" })).toHaveCount(0);
    await expect(page.getByText("Sign out")).toHaveCount(0);
    const looking = page.getByRole("link", { name: "Looking for work?" });
    await expect(looking).toBeVisible();
    expect((await looking.boundingBox())!.x).toBeLessThan((await trigger(page).boundingBox())!.x);
    await expect(trigger(page)).toContainText("ST");
  });

  test("with no organisation the avatar button is still there (with the user's own initials) so Sign out stays reachable", async ({ page }) => {
    await mount(page, "employer", { ...EMPLOYER, orgInitials: null, orgName: "" });
    await expect(trigger(page)).toContainText("SO");
    await trigger(page).click();
    await expect(menu(page).getByRole("menuitem", { name: "Sign out" })).toBeVisible();
  });
});

// The side switch (DASHBOARD-SWITCH-PR1-1). The existing tests above never pass the switch props, so they run on a menu without the item and stay as they were; these add it.
const SEEKER_MEMBER = { ...SEEKER, isOrganisationMember: true };
const EMPLOYER_WITH_SWITCH = { ...EMPLOYER, canSwitchToSeeker: true };

for (const kind of ["seeker", "employer"] as const) {
  const withSwitch = kind === "seeker" ? SEEKER_MEMBER : EMPLOYER_WITH_SWITCH;
  const without = kind === "seeker" ? SEEKER : EMPLOYER;
  const label = kind === "seeker" ? "Switch to Employer" : "Switch to Job seeker";
  const side = kind === "seeker" ? "employer" : "seeker";
  const min = kind === "employer" ? 44 : 40;

  test.describe(`${kind} header: the side switch item`, () => {
    test("is absent when the account cannot switch", async ({ page }) => {
      await mount(page, kind, without);
      await trigger(page).click();
      await expect(menu(page).getByRole("menuitem")).toHaveText(["Settings", "Sign out"]);
      await expect(page.getByText(/Switch to/)).toHaveCount(0);
    });

    test(`is present as "${label}", between Settings and Sign out`, async ({ page }) => {
      await mount(page, kind, withSwitch);
      await trigger(page).click();
      await expect(menu(page).getByRole("menuitem")).toHaveText(["Settings", label, "Sign out"]);
      const text = (await menu(page).innerText()).split("\n").map((l) => l.trim()).filter(Boolean);
      expect(text).toEqual([withSwitch.displayName, withSwitch.email, "Settings", label, "Sign out"]);
    });

    test("Tab goes Settings, then the switch, then Sign out, and Shift+Tab goes back", async ({ page }) => {
      await mount(page, kind, withSwitch);
      await trigger(page).click();
      await expect(menu(page).getByRole("menuitem", { name: "Settings" })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(menu(page).getByRole("menuitem", { name: label })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(menu(page).getByRole("menuitem", { name: "Sign out" })).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(menu(page).getByRole("menuitem", { name: label })).toBeFocused();
    });

    test(`submits the side "${side}" and nothing else, and does not sign out`, async ({ page }) => {
      await mount(page, kind, withSwitch);
      await trigger(page).click();
      const hidden = await menu(page).locator('input[type="hidden"]').evaluateAll((els) => els.map((e) => [(e as HTMLInputElement).name, (e as HTMLInputElement).value]));
      expect(hidden).toEqual([["side", side]]);
      await menu(page).getByRole("menuitem", { name: label }).click();
      expect(await page.evaluate(() => window.__switched)).toEqual([side]);
      expect(await signOuts(page)).toBe(0);
    });

    test(`is ${min}px tall (the menu's own size for this header) and the longer menu stays inside a 375px screen`, async ({ page }) => {
      await mount(page, kind, withSwitch, 375);
      await trigger(page).click();
      const item = (await menu(page).getByRole("menuitem", { name: label }).boundingBox())!;
      expect(item.height).toBeGreaterThanOrEqual(min);
      expect(item.height).toBeLessThan(min + 1);
      expect(item.width).toBeGreaterThanOrEqual(min);
      const m = (await menu(page).boundingBox())!;
      expect(m.x).toBeGreaterThanOrEqual(0);
      expect(m.x + m.width).toBeLessThanOrEqual(375);
    });

    test("opens with focus on Settings and Escape still closes it and returns focus to the button", async ({ page }) => {
      await mount(page, kind, withSwitch);
      await trigger(page).click();
      await expect(menu(page).getByRole("menuitem", { name: "Settings" })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(menu(page)).toHaveCount(0);
      await expect(trigger(page)).toBeFocused();
    });
  });
}
