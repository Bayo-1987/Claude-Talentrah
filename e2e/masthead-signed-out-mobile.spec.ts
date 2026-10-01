/**
 * send-488 — the signed-out masthead on a phone.
 *
 * ── WHAT WAS WRONG ────────────────────────────────────────────────────────
 * On every page that renders the marketing masthead (src/components/marketing/marketing-masthead.tsx:
 * the marketing pages, the signed-out app shell, and so since #607 /jobs and /tracker too), at phone
 * widths "Log in" wrapped onto two lines and "Get started for free" onto up to FOUR (360px: 110x120).
 * The bar's row is a fixed 78px, so the CTA stuck out of it. The document did not overflow
 * (`scrollWidth === clientWidth` at every width), so a scrollWidth check alone passes on the broken
 * layout. This spec therefore measures what a scrollWidth check cannot, the same lesson as
 * e2e/masthead-nav-fit.spec.ts:
 *   - whether each control's TEXT is on one line (visible text-node line boxes, not the control's height);
 *   - whether each control sits INSIDE the bar's row (the spill-out);
 *   - the real hit areas (getBoundingClientRect), at 44px for THIS masthead (the repo-wide floor in
 *     e2e/hit-targets.spec.ts stays 40px; raising it is a follow-up, not part of this change).
 *
 * Signed-out and database-free: it imports nothing from ./fixtures, so it can be pointed at any
 * deployment with E2E_BASE_URL. Every page below renders the SAME component; they are all measured
 * because the signed-out app shell and the marketing pages mount it differently.
 */
import { test, expect, type Page } from "@playwright/test";

const PAGES = ["/", "/about", "/scholarships", "/jobs", "/tracker"];
const PHONE_WIDTHS = [360, 375, 390, 412];

type Box = { x: number; y: number; w: number; h: number; r: number; b: number };
type Measured = {
  row: Box;
  vw: number;
  scrollW: number;
  clientW: number;
  controls: Record<"logo" | "menu" | "login" | "cta", Box & { lines: number | null; visibleLabel: string }>;
};

/** Every number here is read from the live page: a class name says nothing about a rendered size. */
async function measure(page: Page): Promise<Measured> {
  return page.evaluate(() => {
    const header = document.querySelector("header")!;
    const box = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.x + r.width, b: r.y + r.height };
    };
    // Lines of VISIBLE text: walk the text nodes whose ancestors are not display:none, and count the
    // distinct line boxes. (A Range over the whole element also counts hidden spans and element
    // boxes, and an element's height says nothing: a min-height hides a wrapped line.)
    const lines = (el: Element) => {
      const tops = new Set<number>();
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent?.trim()) continue;
        let hidden = false;
        for (let e = n.parentElement; e && e !== el.parentElement; e = e.parentElement) {
          if (getComputedStyle(e).display === "none") {
            hidden = true;
            break;
          }
        }
        if (hidden) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const q of Array.from(range.getClientRects())) if (q.width > 0) tops.add(Math.round(q.top));
      }
      return tops.size;
    };
    const find = (sel: string) => {
      const el = header.querySelector(sel);
      if (!el) throw new Error(`masthead control not found: ${sel}`);
      return el;
    };
    const logo = find('a[href="/"]');
    const menu = find('button[aria-label="Main menu"]');
    const login = find('a[href="/login"]');
    const cta = find('a[href="/signup"]');
    const withText = (el: Element) => ({
      ...box(el),
      lines: lines(el),
      visibleLabel: ((el as HTMLElement).innerText || "").trim(),
    });
    return {
      row: box(header.firstElementChild!),
      vw: window.innerWidth,
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      controls: {
        logo: { ...box(logo), lines: null, visibleLabel: "" },
        menu: { ...box(menu), lines: null, visibleLabel: "" },
        login: withText(login),
        cta: withText(cta),
      },
    };
  });
}

async function open(page: Page, path: string, width: number) {
  await page.setViewportSize({ width, height: 844 });
  const res = await page.goto(path);
  expect(res?.status(), `${path} must render signed out, not redirect`).toBe(200);
  expect(page.url(), `${path} redirected a signed-out visitor`).not.toContain("/login");
  await expect(page.locator("header").first().locator('a[href="/signup"]')).toBeVisible();
}

test.describe("signed-out masthead on a phone (send-488)", () => {
  for (const width of PHONE_WIDTHS) {
    test(`${width}px: no control wraps, and none spills out of the bar`, async ({ page }) => {
      for (const path of PAGES) {
        await open(page, path, width);
        const m = await measure(page);
        const where = `${path} @ ${width}px`;

        expect(m.controls.login.lines, `${where}: "Log in" wraps`).toBe(1);
        expect(m.controls.cta.lines, `${where}: the sign-up CTA wraps`).toBe(1);

        // THE SPILL: the row is a fixed height; every control must sit inside it. At 360px the CTA was
        // 120px tall in a 78px row and stuck out of the bar, with the document's scrollWidth unchanged.
        for (const [name, c] of Object.entries(m.controls)) {
          expect(c.y, `${where}: ${name} starts above the bar (y=${c.y.toFixed(1)}, bar top ${m.row.y.toFixed(1)})`).toBeGreaterThanOrEqual(
            m.row.y - 0.5,
          );
          expect(c.b, `${where}: ${name} runs below the bar (bottom ${c.b.toFixed(1)}, bar bottom ${m.row.b.toFixed(1)})`).toBeLessThanOrEqual(
            m.row.b + 0.5,
          );
        }

        // No two controls overlap, and nothing is closer than 16px to either screen edge.
        const names = Object.keys(m.controls) as (keyof Measured["controls"])[];
        for (let i = 0; i < names.length; i++) {
          for (let j = i + 1; j < names.length; j++) {
            const a = m.controls[names[i]];
            const b = m.controls[names[j]];
            const overlap = a.x < b.r - 0.5 && b.x < a.r - 0.5 && a.y < b.b - 0.5 && b.y < a.b - 0.5;
            expect(overlap, `${where}: ${names[i]} overlaps ${names[j]}`).toBe(false);
          }
        }
        expect(m.controls.logo.x, `${where}: logo is within 16px of the left edge`).toBeGreaterThanOrEqual(16);
        expect(m.vw - m.controls.cta.r, `${where}: the CTA is within 16px of the right edge`).toBeGreaterThanOrEqual(16);
      }
    });

    test(`${width}px: the page does not scroll sideways`, async ({ page }) => {
      for (const path of PAGES) {
        await open(page, path, width);
        const m = await measure(page);
        expect(m.scrollW, `${path} @ ${width}px`).toBeLessThanOrEqual(m.clientW);
      }
    });

    test(`${width}px: every masthead control is at least 44x44`, async ({ page }) => {
      for (const path of PAGES) {
        await open(page, path, width);
        const m = await measure(page);
        for (const [name, c] of Object.entries(m.controls)) {
          expect(c.w, `${path} @ ${width}px: ${name} is ${c.w.toFixed(1)}px wide`).toBeGreaterThanOrEqual(43.99);
          expect(c.h, `${path} @ ${width}px: ${name} is ${c.h.toFixed(1)}px tall`).toBeGreaterThanOrEqual(43.99);
        }
      }
    });

    test(`${width}px: accessible names are unchanged`, async ({ page }) => {
      for (const path of PAGES) {
        await open(page, path, width);
        const header = page.locator("header").first();
        await expect(header.getByRole("link", { name: "Log in", exact: true }), path).toBeVisible();
        // The accessible name stays the full phrase even where the visible label is shortened.
        await expect(header.getByRole("link", { name: "Get started for free", exact: true }), path).toBeVisible();
        await expect(header.getByRole("button", { name: "Main menu", exact: true }), path).toBeVisible();
        await expect(header.getByRole("link", { name: "Talentrah", exact: true }), path).toBeVisible();
      }
    });
  }

  test("the visible CTA label is the short one below 640px and the full one from 640px up", async ({ page }) => {
    await open(page, "/about", 639);
    expect((await measure(page)).controls.cta.visibleLabel).toBe("Get started");
    await open(page, "/about", 640);
    expect((await measure(page)).controls.cta.visibleLabel).toBe("Get started for free");
  });

  test("the menu still works at 390px: it opens, holds the same four links, and Escape closes it with focus on the button", async ({
    page,
  }) => {
    await open(page, "/", 390);
    const trigger = page.getByRole("button", { name: "Main menu" });
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");

    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    const items = menu.getByRole("menuitem");
    // Pinned, in order: this is the list the masthead shipped with before this change.
    await expect(items).toHaveText(["Browse Jobs", "Meet Farah", "How it works", "FAQs"]);
    expect(await items.evaluateAll((els) => els.map((e) => e.getAttribute("href")))).toEqual([
      "/#jobs",
      "/#farah",
      "/#how-it-works",
      "/#faqs",
    ]);
    // Every item is a real, 44px-tall target.
    for (const box of await items.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) {
      expect(box).toBeGreaterThanOrEqual(43.99);
    }

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger, "focus must be on the hamburger after Escape").toBeFocused();
  });

  test("keyboard focus is visible on Log in, the CTA and the hamburger at 390px", async ({ page }) => {
    for (const [name, selector] of [
      ["Log in", 'header a[href="/login"]'],
      ["the CTA", 'header a[href="/signup"]'],
      ["the hamburger", 'header button[aria-label="Main menu"]'],
    ] as const) {
      // A fresh page for each control, so Tab starts from the top of the document every time (the
      // browser keeps its sequential-focus position between presses, so one page cannot be reused).
      // Tab until the control has focus: focus-visible is only true for keyboard-driven focus, so
      // .focus() or a click would not prove what a keyboard user actually sees.
      await open(page, "/", 390);
      let focused = false;
      for (let i = 0; i < 25 && !focused; i++) {
        await page.keyboard.press("Tab");
        focused = await page.evaluate((sel) => document.activeElement === document.querySelector(sel), selector);
      }
      expect(focused, `${name} never received keyboard focus`).toBe(true);
      const ring = await page.evaluate((sel) => {
        const el = document.querySelector(sel)!;
        const cs = getComputedStyle(el);
        return {
          focusVisible: el.matches(":focus-visible"),
          outlineStyle: cs.outlineStyle,
          outlineWidth: parseFloat(cs.outlineWidth),
          boxShadow: cs.boxShadow,
        };
      }, selector);
      expect(ring.focusVisible, `${name}: :focus-visible does not match`).toBe(true);
      const visible = (ring.outlineStyle !== "none" && ring.outlineWidth > 0) || ring.boxShadow !== "none";
      expect(visible, `${name} shows no focus ring (outline ${ring.outlineStyle} ${ring.outlineWidth}px, shadow ${ring.boxShadow})`).toBe(true);
    }
  });
});

/**
 * DESKTOP DOES NOT CHANGE. Proven once, by hand, by comparing before/after screenshots of the header at
 * 1280, 1000, 900, 899, 700 and 640px (byte-identical PNGs: only widths below 640px differ). The repo has no
 * committed screenshot baselines (they are platform-specific, and CI renders on Linux), so what CI guards
 * is the geometry: the sizes below are the ones measured on main before this change.
 */
test.describe("the masthead from 640px up is unchanged (send-488)", () => {
  for (const width of [1280, 900, 640]) {
    test(`${width}px: control sizes and the full label are as before`, async ({ page }) => {
      await open(page, "/about", width);
      const m = await measure(page);
      expect(m.row.h).toBeCloseTo(78, 0);
      expect(m.controls.login.w).toBeCloseTo(52.8, 0);
      expect(m.controls.login.h).toBeCloseTo(44, 0);
      expect(m.controls.cta.w).toBeCloseTo(192.8, 0);
      expect(m.controls.cta.h).toBeCloseTo(52.5, 0);
      expect(m.controls.cta.visibleLabel).toBe("Get started for free");
      expect(m.controls.cta.lines).toBe(1);
      // The bar keeps its 40px side padding: the logo starts at (viewport - content) / 2 + 40 at most widths,
      // and at exactly 40px on any viewport narrower than the 1120px max width.
      if (width < 1200) expect(m.controls.logo.x).toBeCloseTo(40, 0);
    });
  }

  test("the nav bar shows from 900px and the hamburger from 899px down", async ({ page }) => {
    await open(page, "/about", 900);
    await expect(page.locator("header nav").first()).toBeVisible();
    await expect(page.locator('header button[aria-label="Main menu"]')).toBeHidden();
    await open(page, "/about", 899);
    await expect(page.locator("header nav").first()).toBeHidden();
    await expect(page.locator('header button[aria-label="Main menu"]')).toBeVisible();
  });
});
