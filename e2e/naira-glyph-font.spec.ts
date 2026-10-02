/**
 * send-503 / S18 — the big credit-pack price draws its ₦ in Newsreader, not in a fallback face.
 *
 * NairaAmount used to set the sign in a separate `font-body` span because the Newsreader of send-401 had no usable ₦ glyph (a screenshot
 * showed "N0"). It now renders ONE text node ("₦2,500") in the display font, which is only right while Newsreader itself draws the
 * sign. A text assertion cannot see that: "₦2,500" is the same string whichever font paints it. So this asks Chrome which font ACTUALLY
 * rendered the glyphs (CDP CSS.getPlatformFontsForNode: the real platform font per glyph run, not the font-family declaration).
 *
 * Proven able to discriminate on a static page with the committed font files: the new markup reports Newsreader for all 24 glyphs, the
 * old span markup reports IBM Plex Sans for the ₦ glyphs, and a Georgia-only element reports Times New Roman (a fallback) for them.
 * The control test below repeats the Georgia case inside the app so a regression to a fallback cannot pass for the wrong reason.
 *
 * Chromium only (CDP). NOT run locally: it needs a signed-in session and a database, so its first run is this PR's CI.
 * If it cannot be made deterministic on the CI runner, the right response is to restore the separate font-body span, not to skip it.
 */
import { test, expect } from "./fixtures/authed";
import type { Page } from "@playwright/test";

interface PlatformFont {
  familyName: string;
  isCustomFont: boolean;
  glyphCount: number;
}

async function platformFonts(page: Page, selector: string): Promise<PlatformFont[]> {
  const client = await page.context().newCDPSession(page);
  try {
    await client.send("DOM.enable");
    await client.send("CSS.enable");
    const { root } = await client.send("DOM.getDocument", { depth: 0 });
    const { nodeId } = await client.send("DOM.querySelector", { nodeId: root.nodeId, selector });
    if (!nodeId) throw new Error(`no element matches ${selector}`);
    const { fonts } = await client.send("CSS.getPlatformFontsForNode", { nodeId });
    return fonts;
  } finally {
    await client.detach();
  }
}

test.describe("the big credit-pack price", () => {
  test("draws every glyph, the ₦ included, in Newsreader (a real web font), not a fallback face", async ({ authedPage, browserName }) => {
    test.skip(browserName !== "chromium", "uses the Chrome DevTools Protocol");
    await authedPage.goto("/billing");

    const price = authedPage.getByTestId("credit-pack-price").first();
    await expect(price).toBeVisible();
    const text = (await price.innerText()).trim();
    expect(text, "the price is one string starting with the sign").toMatch(/^₦[\d,]+$/);

    // The latin-ext subset that holds U+20A6 is fetched on demand (unicode-range): ask for it and wait for every face.
    await authedPage.evaluate(async () => {
      await document.fonts.load('24px "Newsreader"', "₦");
      await document.fonts.ready;
    });

    // Poll rather than sleep: the font swap is asynchronous. A permanent fallback never converges, and fails with the real answer.
    await expect
      .poll(async () => JSON.stringify(await platformFonts(authedPage, '[data-testid="credit-pack-price"]')), {
        message: "the fonts that actually painted the price",
        timeout: 15_000,
      })
      .toMatch(/"familyName":"Newsreader/);

    const fonts = await platformFonts(authedPage, '[data-testid="credit-pack-price"]');
    expect(fonts, "exactly one font painted the whole price: no per-glyph fallback for the ₦").toHaveLength(1);
    expect(fonts[0].familyName).toMatch(/^Newsreader/);
    expect(fonts[0].isCustomFont, "a self-hosted web font, not an installed one").toBe(true);
    expect(fonts[0].glyphCount, "every glyph, the ₦ included").toBe([...text].length);
  });

  test("control: the same sign set in a system serif IS reported as a fallback (so the check above can fail)", async ({ authedPage, browserName }) => {
    test.skip(browserName !== "chromium", "uses the Chrome DevTools Protocol");
    await authedPage.goto("/billing");
    await authedPage.evaluate(() => {
      const el = document.createElement("p");
      el.id = "naira-control";
      el.style.cssText = "font:24px Georgia, 'Times New Roman', serif; position:absolute; top:0; left:0;";
      el.textContent = "₦2,500";
      document.body.appendChild(el);
    });
    const fonts = await platformFonts(authedPage, "#naira-control");
    expect(fonts.length).toBeGreaterThan(0);
    expect(fonts.every((f) => !/^Newsreader/.test(f.familyName)), `got ${JSON.stringify(fonts)}`).toBe(true);
    expect(fonts.every((f) => f.isCustomFont === false)).toBe(true);
  });
});
