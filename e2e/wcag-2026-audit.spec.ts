/**
 * send-381 — regression coverage for four real WCAG 2.1 AA gaps found by a
 * live accessibility audit against production: no visible keyboard focus
 * indicator on five fields (2.4.7), `--line` failing 3:1 non-text contrast
 * as IconButton/FilterChip's resting border (1.4.11), and no landmark
 * regions anywhere on the marketing site (1.3.1/2.4.1).
 *
 * Every assertion here reads a REAL computed style from a REAL rendered
 * page (getComputedStyle via page.evaluate, or DOM landmark queries) —
 * never a className string — because a className is not what a keyboard
 * user or a screen reader actually experiences. The contrast math mirrors
 * the audit's own method: pull the real rendered color, convert to relative
 * luminance, compute the WCAG ratio.
 */
import { test, expect, admin } from "./fixtures/authed";
import type { Page } from "@playwright/test";

/**
 * Normalizes ANY CSS color string to 0-255 sRGB via a 1x1 canvas readback.
 *
 * getComputedStyle can hand back `lab(...)`/`oklch(...)` rather than
 * `rgb(...)` for a color defined in a wide-gamut space (this app's own
 * design tokens are oklch — see globals.css) — a plain regex over "rgb("
 * silently mis-parses or throws on those. Canvas's 2D context always reads
 * pixels back as legacy 0-255 sRGB regardless of the input color space, so
 * this is the one normalization that can't drift out of sync with whatever
 * format a given browser happens to serialize computed styles in.
 */
function normalizeToSrgb(page: Page, cssColor: string): Promise<[number, number, number]> {
  return page.evaluate((color) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return [r, g, b] as [number, number, number];
  }, cssColor);
}

/** WCAG relative luminance from 0-255 sRGB components. */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [R, G, B] = [channel(r), channel(g), channel(b)];
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrastRatio(rgb1: [number, number, number], rgb2: [number, number, number]): number {
  const l1 = relativeLuminance(rgb1);
  const l2 = relativeLuminance(rgb2);
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

async function borderColor(page: Page, selector: string): Promise<string> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`not found: ${sel}`);
    return getComputedStyle(el).borderTopColor;
  }, selector);
}

async function borderWidth(page: Page, selector: string): Promise<string> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`not found: ${sel}`);
    return getComputedStyle(el).borderTopWidth;
  }, selector);
}

test.describe("2.4.7 — real visible keyboard focus indicators", () => {
  test("the homepage JD demo textarea's wrapping box changes border color on focus", async ({ page }) => {
    await page.goto("/");
    // The textarea itself is border-none; the indicator lives on the form
    // that wraps it (focus-within). Read the SAME element (the form) both
    // before and after — an earlier draft of this test compared the
    // textarea's own (irrelevant) border to the form's, which "passed" no
    // matter what the fix did because it was comparing two different
    // elements. Caught by deliberately reverting the fix and watching this
    // version fail while that one didn't.
    const readFormBorder = () =>
      page.evaluate(() => {
        const textarea = document.getElementById("jd-demo")!;
        const form = textarea.closest("form")!;
        return getComputedStyle(form).borderTopColor;
      });

    const before = await readFormBorder();
    await page.locator("#jd-demo").focus();
    const after = await readFormBorder();

    expect(after, "MONEY BUG target: focusing the JD demo textarea must visibly change its box's border").not.toBe(
      before,
    );
  });

  test("the job search bar's bordered box changes border color when the search field is focused", async ({
    authedPage,
  }) => {
    await authedPage.goto("/jobs");
    const box = '[data-testid="applied-filters"]';
    const before = await borderColor(authedPage, box);

    await authedPage.locator("#job-search").focus();
    const after = await borderColor(authedPage, box);

    expect(after, "focusing the search input must change the surrounding box's border color").not.toBe(before);
  });

  test("the Farah chat input's wrapping form changes border color on focus", async ({ authedPage }) => {
    await authedPage.goto("/jobs");
    const input = authedPage.getByPlaceholder("Ask me anything…").first();
    await input.waitFor();
    const formSelectorScript = () => {
      const el = document.querySelector('input[placeholder="Ask me anything…"]');
      const form = el?.closest("form");
      return form ? getComputedStyle(form).borderTopColor : null;
    };
    const before = await authedPage.evaluate(formSelectorScript);

    await input.focus();
    const after = await authedPage.evaluate(formSelectorScript);

    expect(after, "focusing the Farah input must change its form's border color").not.toBe(before);
  });

  test("a tracker note's textarea shows a heavier border while focused than once blurred", async ({
    authedPage,
    testUser,
  }) => {
    const { data: app, error } = await admin
      .from("applications")
      .insert({
        user_id: testUser.id,
        stage: "applied",
        applied_at: new Date().toISOString(),
        notes: null,
        manual_job_snapshot: { companyName: "send-381 fixture co", title: "QA Engineer", location: "Remote" },
      })
      .select("id")
      .single();
    if (error || !app) throw new Error(`fixture application: ${error?.message}`);

    await authedPage.goto("/tracker");
    await authedPage.getByRole("heading", { name: "QA Engineer" }).first().waitFor();
    await authedPage.getByTestId("notes-add").click();
    await authedPage.getByTestId("notes-textarea").waitFor();

    // Auto-focused on entering edit mode (notes-form.tsx's own effect) —
    // capture the focused width first, then blur (click a neutral heading,
    // never the Save/Cancel buttons — this test is about the border, not
    // about submitting) and compare.
    const focusedWidth = await borderWidth(authedPage, '[data-testid="notes-textarea"]');
    await authedPage.getByRole("heading", { name: "QA Engineer" }).first().click();
    const blurredWidth = await borderWidth(authedPage, '[data-testid="notes-textarea"]');

    expect(
      focusedWidth,
      "MONEY BUG target: a keyboard user could not tell focused from merely-editing on this field",
    ).not.toBe(blurredWidth);

    await admin.from("applications").delete().eq("id", app.id);
  });

  test("a resume rename field shows a heavier border while focused than once blurred", async ({
    authedPage,
    testUser,
  }) => {
    await seedBaseResumeFixture(testUser.id);
    await authedPage.goto("/resume-builder");
    await authedPage.getByRole("button", { name: "Rename" }).first().click();
    const input = authedPage.getByTestId("resume-rename-input");
    await input.waitFor();

    // Auto-focused on entering rename mode (resume-list-row.tsx's own effect).
    const focusedWidth = await borderWidth(authedPage, '[data-testid="resume-rename-input"]');
    await authedPage.getByRole("heading", { name: "Build a resume that fits the role." }).click();
    const blurredWidth = await borderWidth(authedPage, '[data-testid="resume-rename-input"]');

    expect(
      focusedWidth,
      "MONEY BUG target: a keyboard user could not tell focused from merely-editing on this field",
    ).not.toBe(blurredWidth);
  });
});

async function seedBaseResumeFixture(userId: string) {
  const { error } = await admin.from("resumes").insert({
    user_id: userId,
    title: "send-381 fixture resume",
    is_base: true,
    source: "uploaded",
    structured_content: {
      contact: { name: "Fixture Person", email: "fixture@talentrah.test", location: "Lagos, Nigeria" },
      summary: "Fixture resume for focus-indicator regression coverage.",
      experience: [],
      education: [],
      skills: [],
      projects: [],
      certifications: [],
    },
  });
  if (error) throw new Error(`fixture resume: ${error.message}`);
}

test.describe("1.3.1 / 2.4.1 — marketing site landmark regions", () => {
  async function landmarks(page: Page) {
    return page.evaluate(() => ({
      main: document.querySelectorAll("main").length,
      header: document.querySelectorAll("header").length,
      footer: document.querySelectorAll("footer").length,
      skipLink: !!document.querySelector('a[href="#main-content"]'),
      mainHasId: !!document.getElementById("main-content"),
    }));
  }

  test("the homepage has exactly one main, header, and footer, plus a working skip link", async ({ page }) => {
    await page.goto("/");
    const found = await landmarks(page);
    expect(found, "MONEY BUG target: the homepage had zero header/main/footer landmarks before this fix").toEqual({
      main: 1,
      header: 1,
      footer: 1,
      skipLink: true,
      mainHasId: true,
    });
  });

  test("a second marketing page (/about) reusing the shared masthead/footer also has all three landmarks", async ({
    page,
  }) => {
    await page.goto("/about");
    const found = await landmarks(page);
    expect(found).toEqual({ main: 1, header: 1, footer: 1, skipLink: true, mainHasId: true });
  });

  test("a legal page (via the shared LegalPage shell) also has all three landmarks", async ({ page }) => {
    await page.goto("/legal/privacy");
    const found = await landmarks(page);
    expect(found).toEqual({ main: 1, header: 1, footer: 1, skipLink: true, mainHasId: true });
  });

  test("the login page (a different shared layout, not MarketingMasthead/Footer) has its own main landmark", async ({
    page,
  }) => {
    await page.goto("/login");
    const found = await page.evaluate(() => ({
      main: document.querySelectorAll("main").length,
      mainHasId: !!document.getElementById("main-content"),
    }));
    expect(found).toEqual({ main: 1, mainHasId: true });
  });
});

test.describe("1.4.11 — IconButton / FilterChip resting border now clears 3:1", () => {
  test("IconButton's resting border clears 3:1 against both --paper and --card", async ({ page }) => {
    await page.goto("/dev/design-check");
    const iconButton = page.getByRole("button", { name: "Save" }).first();
    await iconButton.waitFor();

    const [borderRgbStr, paperRgbStr, cardRgbStr] = await page.evaluate(() => {
      const btn = document.querySelector('button[aria-label="Save"]')!;
      const border = getComputedStyle(btn).borderTopColor;
      const paper = getComputedStyle(document.body).backgroundColor;
      const cardEl = document.querySelector(".bg-card")!;
      const card = getComputedStyle(cardEl).backgroundColor;
      return [border, paper, card];
    });

    const border = await normalizeToSrgb(page, borderRgbStr);
    const paper = await normalizeToSrgb(page, paperRgbStr);
    const card = await normalizeToSrgb(page, cardRgbStr);

    const ratioVsPaper = contrastRatio(border, paper);
    const ratioVsCard = contrastRatio(border, card);

    expect(ratioVsPaper, `IconButton border vs --paper: ${ratioVsPaper.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    expect(ratioVsCard, `IconButton border vs --card: ${ratioVsCard.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
  });

  test("FilterChip's resting border clears 3:1 against --paper", async ({ page }) => {
    await page.goto("/dev/design-check");
    const chip = page.getByText("Product", { exact: false }).first();
    await chip.waitFor();

    const [borderRgbStr, paperRgbStr] = await page.evaluate(() => {
      const chipEl = [...document.querySelectorAll("span")].find((el) =>
        el.textContent?.trim().startsWith("Product"),
      )!;
      const border = getComputedStyle(chipEl).borderTopColor;
      const paper = getComputedStyle(document.body).backgroundColor;
      return [border, paper];
    });

    const border = await normalizeToSrgb(page, borderRgbStr);
    const paper = await normalizeToSrgb(page, paperRgbStr);
    const ratio = contrastRatio(border, paper);
    expect(ratio, `FilterChip border vs --paper: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
  });
});
