import { test, expect } from "@playwright/test";

/**
 * The chrome every signed-in page renders: the masthead and the Farah panel.
 *
 * TWO SEPARATE DEFECTS, both found by measuring rather than reading.
 *
 * 1. HIT TARGETS. CLAUDE.md fixes a >=40x40px minimum and records under-sized
 *    targets as a bug this project has already shipped. Measured at 1280px
 *    before this change:
 *
 *      brand link       128 x 32
 *      "Jobs"          29.5 x 40    (min-h-10 with no min-w-10 — the exact
 *                                    shape #69 fixed in the filter bar)
 *      "Sign out"      46.2 x 19.5
 *      "View profile"  61.3 x 18
 *      Farah's input    177 x 18.8
 *
 * 2. THE ACTIVE STATE DID NOT RENDER. `cn` in this repo is a plain join, not
 *    tailwind-merge, so a base `border-transparent text-ink-soft` and a
 *    conditional `border-rust text-ink` both reach the class attribute. Equal
 *    specificity means the stylesheet's own order decides — and the base won
 *    both. On /jobs and /tracker the active tab was rendering IDENTICALLY to
 *    the inactive ones. The masthead was half-broken: rust text (which happens
 *    to sort after ink) with no underline.
 *
 * The second test is written as a COMPARISON rather than against literal
 * colours. Asserting "rust" would pass on a component where every tab is rust;
 * what actually matters is that the active one is distinguishable.
 *
 * Overlaps `e2e/hit-targets.spec.ts` on the fix/hit-targets branch, which
 * covers the feed's filter rows. Fold them together once both land.
 */
const MIN = 40;
const DEMO_PASSWORD = process.env.DEMO_PASSWORD;

if (process.env.CI && !DEMO_PASSWORD) {
  // A skip must not read as a pass on the summary line.
  throw new Error("app-chrome spec cannot run in CI: DEMO_PASSWORD is not set");
}

test.use({ viewport: { width: 1280, height: 900 } });

test.beforeEach(async ({ page }) => {
  test.skip(!DEMO_PASSWORD, "DEMO_PASSWORD is not set — see scripts/seed.ts");
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo@talentrah.dev");
  await page.getByLabel("Password").fill(DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/jobs");
});

test("every interactive element in the masthead and panel is at least 40x40", async ({ page }) => {
  await page.goto("/feedback");
  await page.getByRole("navigation").waitFor();

  const measured = await page.evaluate((min) => {
    const regions: [string, string][] = [
      ["masthead", "div.border-b-\\[2\\.5px\\]"],
      ["farah panel", "div.border-l"],
    ];
    const all: { region: string; text: string; w: number; h: number }[] = [];
    for (const [name, sel] of regions) {
      const root = document.querySelector(sel);
      if (!root) continue;
      root.querySelectorAll("a,button,input,select,textarea").forEach((e) => {
        const el = e as HTMLElement;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        if ((el as HTMLInputElement).type === "hidden") return;
        all.push({
          region: name,
          text: (el.textContent || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.tagName)
            .trim()
            .slice(0, 24),
          w: Math.round(r.width * 10) / 10,
          h: Math.round(r.height * 10) / 10,
        });
      });
    }
    return { total: all.length, undersized: all.filter((m) => m.w < min || m.h < min) };
  }, MIN);

  // Guard against a vacuous pass: an empty page has no undersized targets.
  // The masthead alone renders eleven, and the panel eight.
  expect(measured.total).toBeGreaterThanOrEqual(15);
  expect(measured.undersized).toEqual([]);
});

test("the active nav item is visibly distinguishable from the inactive ones", async ({ page }) => {
  const read = (label: string) =>
    page.evaluate((l) => {
      const a = [...document.querySelectorAll("a")].find((x) => x.textContent!.trim() === l);
      if (!a) return null;
      const s = getComputedStyle(a);
      return { border: s.borderBottomColor, color: s.color };
    }, label);

  const TRANSPARENT = "rgba(0, 0, 0, 0)";

  // Masthead: /jobs is active.
  const navActive = await read("Jobs");
  const navIdle = await read("Job Tracker");
  expect(navActive, "the Jobs nav link should exist").not.toBeNull();
  expect(navActive!.border).not.toBe(TRANSPARENT);
  expect(navIdle!.border).toBe(TRANSPARENT);
  expect(navActive!.color).not.toBe(navIdle!.color);

  // Feed tabs: Recommended is the default.
  const tabActive = await read("Recommended");
  const tabIdle = await read("Most Recent");
  expect(tabActive!.border).not.toBe(TRANSPARENT);
  expect(tabIdle!.border).toBe(TRANSPARENT);
  expect(tabActive!.color).not.toBe(tabIdle!.color);

  // Tracker stage filter: All is the default.
  await page.goto("/tracker");
  await page.getByRole("link", { name: "All", exact: true }).waitFor();
  const stageActive = await read("All");
  const stageIdle = await read("Applied");
  expect(stageActive!.border).not.toBe(TRANSPARENT);
  expect(stageIdle!.border).toBe(TRANSPARENT);
  expect(stageActive!.color).not.toBe(stageIdle!.color);
});

test("a select the caller has not pre-answered starts on its placeholder", async ({ page }) => {
  // The unit suite covers the component; this covers the two real forms,
  // where the failure was silent — /contact filed every untouched submission
  // as "General question".
  await page.goto("/feedback");
  expect(await page.getByLabel("What's this about?").inputValue()).toBe("");

  await page.goto("/contact");
  expect(await page.getByLabel("Topic").inputValue()).toBe("");
});
