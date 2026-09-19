/**
 * send-381 — regression coverage for the four WCAG 2.1 AA gaps this branch
 * fixed: no visible keyboard focus indicator on five fields (2.4.7),
 * `--line` failing the 3:1 non-text contrast minimum as IconButton/
 * FilterChip's resting border (1.4.11), and no landmark regions anywhere on
 * the marketing site, the signed-in app shell, or the (auth) layout
 * (1.3.1/2.4.1).
 *
 * Every focus/contrast assertion reads a REAL computed style from a REAL
 * rendered page — never a className string. A className is not what a
 * keyboard user or a screen reader actually experiences, and this class of
 * bug is exactly what shipped and was caught late during manual
 * verification: search-combobox.tsx's `focus:outline-2 focus:outline-rust`
 * classes were textually present and correct, but the outline never
 * rendered, because Tailwind v4's `outline-none` sets a shared
 * `--tw-outline-style: none` custom property that `outline-2` alone just
 * re-reads rather than overriding. `focus:outline-solid` is the actual fix,
 * so the test below asserts `outlineStyle` is literally `"solid"` after
 * focus, not merely "different from before" — a looser assertion would
 * have passed on the broken (missing outline-solid) version too, since
 * outline-color and outline-width both still changed on their own.
 */
import { test, expect, admin, seedBaseResume } from "./fixtures/authed";
import type { Page } from "@playwright/test";

/**
 * Normalizes any CSS color string to 0-255 sRGB via a 1x1 canvas readback.
 *
 * getComputedStyle can hand back `lab(...)`/`oklch(...)` rather than
 * `rgb(...)` for a color defined in a wide-gamut space — this app's own
 * design tokens are oklch (globals.css) — so a regex over "rgb(" would
 * mis-parse or throw on them. A canvas 2D context always reads pixels back
 * as legacy 0-255 sRGB regardless of the input color space, so this can't
 * drift out of sync with whatever format a browser happens to serialize
 * computed styles in.
 */
function toSrgb(page: Page, cssColor: string): Promise<[number, number, number]> {
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

/** WCAG relative luminance, then contrast ratio, from 0-255 sRGB components — same formula the audit itself used. */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [R, G, B] = [channel(r), channel(g), channel(b)];
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}
function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test.describe("2.4.7 — real visible keyboard focus indicators", () => {
  test("the JD demo textarea's wrapping box changes border color on focus", async ({ page }) => {
    await page.goto("/");
    // Read the SAME element (the form) before and after — the textarea
    // itself is border-none, so comparing ITS border would trivially never
    // change regardless of whether the real fix (on its ancestor form) works.
    const readFormBorder = () =>
      page.evaluate(() => getComputedStyle(document.getElementById("jd-demo")!.closest("form")!).borderColor);
    const before = await readFormBorder();
    await page.locator("#jd-demo").focus();
    const after = await readFormBorder();
    expect(after, "focusing the JD demo textarea must visibly change its wrapping box's border").not.toBe(before);
  });

  test("the search bar input's own outline goes from none to a real solid outline on focus", async ({
    authedPage,
  }) => {
    await authedPage.goto("/jobs");
    const input = authedPage.locator("#job-search");
    await input.waitFor();
    const readOutline = () =>
      input.evaluate((el) => {
        const s = getComputedStyle(el);
        return { style: s.outlineStyle, color: s.outlineColor, width: s.outlineWidth };
      });

    const before = await readOutline();
    await input.focus();
    const after = await readOutline();

    // The exact bug this pins: outline-2/outline-rust alone leave
    // outline-style at "none" (inherited from outline-none's shared
    // --tw-outline-style variable) — color and width can both change while
    // the outline stays completely invisible. Asserting the literal style
    // value is what a looser "after !== before" check would have missed.
    expect(before.style, "sanity: the field must start with no outline").toBe("none");
    expect(after.style, "MONEY BUG target: focus:outline-solid is what actually makes the outline render").toBe(
      "solid",
    );
    expect(after.width).toBe("2px");
    expect(after.color).not.toBe(before.color);
  });

  test("the Farah chat input's wrapping form changes border color on focus", async ({ authedPage }) => {
    await authedPage.goto("/jobs");
    const input = authedPage.getByPlaceholder("Ask me anything…");
    await input.waitFor();
    const readFormBorder = () =>
      input.evaluate((el) => getComputedStyle(el.closest("form")!).borderColor);
    const before = await readFormBorder();
    await input.focus();
    const after = await readFormBorder();
    expect(after, "focusing the Farah input must change its wrapping form's border color").not.toBe(before);
  });

  test("a tracker note's textarea gets a heavier border while focused than once blurred", async ({
    authedPage,
    testUser,
  }) => {
    const { data: app, error } = await admin
      .from("applications")
      .insert({
        user_id: testUser.id,
        stage: "applied",
        applied_at: new Date().toISOString(),
        manual_job_snapshot: { companyName: "send-381 fixture co", title: "QA Engineer", location: "Remote" },
      })
      .select("id")
      .single();
    if (error || !app) throw new Error(`fixture application: ${error?.message}`);

    await authedPage.goto("/tracker");
    await authedPage.getByText("QA Engineer").first().waitFor();
    await authedPage.getByTestId("notes-add").click();
    const textarea = authedPage.getByTestId("notes-textarea");
    // notes-form.tsx auto-focuses this on entering edit mode — read the
    // focused width first, then blur onto something neutral (never
    // Save/Cancel, which would submit/exit the form) and compare.
    await expect(textarea).toBeFocused();
    const focusedWidth = await textarea.evaluate((el) => getComputedStyle(el).borderWidth);
    await authedPage.getByText("QA Engineer").first().click();
    await expect(textarea).not.toBeFocused();
    const blurredWidth = await textarea.evaluate((el) => getComputedStyle(el).borderWidth);

    expect(
      focusedWidth,
      "MONEY BUG target: a keyboard user could not tell focused from merely-editing on this field",
    ).not.toBe(blurredWidth);

    await admin.from("applications").delete().eq("id", app.id);
  });

  test("a resume rename field gets a heavier border while focused than once blurred", async ({
    authedPage,
    testUser,
  }) => {
    await seedBaseResume(testUser.id);
    await authedPage.goto("/resume-builder");
    await authedPage.getByTestId("resume-rename").click();
    const input = authedPage.getByTestId("resume-rename-input");
    // resume-list-row.tsx auto-focuses this on entering rename mode.
    await expect(input).toBeFocused();
    const focusedWidth = await input.evaluate((el) => getComputedStyle(el).borderWidth);
    await authedPage.getByTestId("resume-rename-cancel").click();
    await authedPage.getByTestId("resume-rename").click();
    await expect(input).toBeFocused();
    await input.blur();
    await expect(input).not.toBeFocused();
    const blurredWidth = await input.evaluate((el) => getComputedStyle(el).borderWidth);

    expect(
      focusedWidth,
      "MONEY BUG target: a keyboard user could not tell focused from merely-editing on this field",
    ).not.toBe(blurredWidth);
  });
});

test.describe("1.3.1 / 2.4.1 — landmark regions", () => {
  async function marketingLandmarks(page: Page) {
    return page.evaluate(() => ({
      header: document.querySelectorAll("header").length,
      main: document.querySelectorAll("main").length,
      footer: document.querySelectorAll("footer").length,
      skipLink: !!document.querySelector('a[href="#main-content"]'),
      mainHasId: !!document.getElementById("main-content"),
    }));
  }

  test("the homepage has exactly one header, main, and footer, plus a working skip link", async ({ page }) => {
    await page.goto("/");
    expect(await marketingLandmarks(page)).toEqual({
      header: 1,
      main: 1,
      footer: 1,
      skipLink: true,
      mainHasId: true,
    });
  });

  test("a second marketing page (/about) reusing the shared masthead/footer also has all three landmarks", async ({
    page,
  }) => {
    await page.goto("/about");
    expect(await marketingLandmarks(page)).toEqual({
      header: 1,
      main: 1,
      footer: 1,
      skipLink: true,
      mainHasId: true,
    });
  });

  test("a legal page (via the shared LegalPage shell) also has all three landmarks", async ({ page }) => {
    await page.goto("/legal/privacy");
    expect(await marketingLandmarks(page)).toEqual({
      header: 1,
      main: 1,
      footer: 1,
      skipLink: true,
      mainHasId: true,
    });
  });

  test("the signed-in app shell has its own header and main (found while fixing the marketing gap, extended here too)", async ({
    authedPage,
  }) => {
    await authedPage.goto("/jobs");
    const found = await authedPage.evaluate(() => ({
      header: document.querySelectorAll("header").length,
      main: document.querySelectorAll("main").length,
    }));
    expect(found).toEqual({ header: 1, main: 1 });
  });

  test("the (auth) layout (login/signup/forgot-password/reset-password) has its own main", async ({ page }) => {
    await page.goto("/login");
    const found = await page.evaluate(() => ({
      main: document.querySelectorAll("main").length,
    }));
    expect(found).toEqual({ main: 1 });
  });
});

test.describe("1.4.11 — IconButton / FilterChip resting border now clears 3:1", () => {
  test("IconButton's resting border clears 3:1 against both --paper and --card", async ({ page }) => {
    await page.goto("/dev/design-check");
    const button = page.locator('button[aria-label="Save"]');
    await button.waitFor();

    const [borderCss, paperCss, cardCss] = await page.evaluate(() => {
      const btn = document.querySelector('button[aria-label="Save"]')!;
      const cardEl = document.querySelector(".bg-card");
      return [
        getComputedStyle(btn).borderColor,
        getComputedStyle(document.body).backgroundColor,
        cardEl ? getComputedStyle(cardEl).backgroundColor : getComputedStyle(document.body).backgroundColor,
      ];
    });

    const [border, paper, card] = await Promise.all([toSrgb(page, borderCss), toSrgb(page, paperCss), toSrgb(page, cardCss)]);
    const ratioVsPaper = contrastRatio(border, paper);
    const ratioVsCard = contrastRatio(border, card);

    expect(ratioVsPaper, `IconButton border vs --paper: ${ratioVsPaper.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    expect(ratioVsCard, `IconButton border vs --card: ${ratioVsCard.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
  });

  test("FilterChip's resting border clears 3:1 against --paper", async ({ page }) => {
    await page.goto("/dev/design-check");
    await page.getByText("Product", { exact: false }).first().waitFor();

    const [borderCss, paperCss] = await page.evaluate(() => {
      const chip = [...document.querySelectorAll("span")].find((el) => el.textContent?.trim().startsWith("Product"))!;
      return [getComputedStyle(chip).borderColor, getComputedStyle(document.body).backgroundColor];
    });

    const [border, paper] = await Promise.all([toSrgb(page, borderCss), toSrgb(page, paperCss)]);
    const ratio = contrastRatio(border, paper);
    expect(ratio, `FilterChip border vs --paper: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
  });
});
