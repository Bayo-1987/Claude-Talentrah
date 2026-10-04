/**
 * S1-56 PR 1a — the public contact form's message box (the shared TextArea), driven by real typing.
 *
 * Signed-out and database-free (it imports nothing from ./fixtures), so it can run against any build with E2E_BASE_URL. The unit tests
 * pin the markup and the server's cap; this is the part they cannot see: the counter following the keyboard, the hard cap stopping
 * typing at the limit, and a line break counting as one character.
 */
import { test, expect } from "@playwright/test";

const CAP = 5000;

test.describe("contact form message box", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/contact");
  });

  test("is found by its label, and its counter follows what is typed", async ({ page }) => {
    const box = page.getByLabel("Message", { exact: true });
    await expect(box).toBeVisible();
    await expect(page.locator("#message-count")).toHaveText(`0 / ${CAP}`);
    await box.pressSequentially("hello");
    await expect(page.locator("#message-count")).toHaveText(`5 / ${CAP}`);
  });

  test("a line break counts as one character, like the server counts it", async ({ page }) => {
    const box = page.locator("#message");
    await box.pressSequentially("ab");
    await box.press("Enter");
    await box.pressSequentially("cd");
    await expect(page.locator("#message-count")).toHaveText(`5 / ${CAP}`);
  });

  test("typing stops at the cap: no more can be added, and the counter says so", async ({ page }) => {
    const box = page.locator("#message");
    // Programmatic fill is exempt from maxLength in a browser, so the last stretch is real typing.
    await box.fill("x".repeat(CAP - 10));
    await box.pressSequentially("y".repeat(40));
    await expect(page.locator("#message-count")).toHaveText(`${CAP} / ${CAP}`);
    expect((await box.inputValue()).length).toBe(CAP);
    await expect(box).toHaveAttribute("maxlength", String(CAP));
  });

  test("a paste that does not fit is refused whole, with a visible message, and the text is untouched", async ({ page }) => {
    const box = page.locator("#message");
    await box.fill("x".repeat(CAP - 5));
    const refused = await box.evaluate((el) => {
      const data = new DataTransfer();
      data.setData("text/plain", "y".repeat(20));
      const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
      el.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(refused, "the paste was cancelled, not left to be cut to fit").toBe(true);
    await expect(page.locator("[data-paste-message]")).toContainText("That paste is 15 over the limit, so nothing was added");
    expect((await box.inputValue()).length).toBe(CAP - 5);
  });

  test("a paste that fits is left alone and shows no message", async ({ page }) => {
    const box = page.locator("#message");
    await box.fill("hello");
    const prevented = await box.evaluate((el) => {
      const data = new DataTransfer();
      data.setData("text/plain", " there");
      const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
      el.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(prevented).toBe(false);
    await expect(page.locator("[data-paste-message]")).toHaveText("");
  });

  test("while an input method is composing, the value is never truncated or rewritten", async ({ page }) => {
    const box = page.locator("#message");
    await box.fill("x".repeat(CAP - 1));
    await box.evaluate((el, cap) => {
      const area = el as HTMLTextAreaElement;
      area.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      // an input method composing past the cap, one stage at a time, as a Japanese or Chinese IME does
      for (const stage of ["\u306B", "\u306B\u307B", "\u306B\u307B\u3093"]) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
        setter.call(area, "x".repeat(cap - 1) + stage);
        area.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", isComposing: true }));
      }
    }, CAP);
    expect((await box.inputValue()).length, "nothing was cut while composing").toBe(CAP + 2);
    await box.evaluate((el) => el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
    expect((await box.inputValue()).length, "nothing is cut when the composition ends either").toBe(CAP + 2);
    await expect(page.locator("#message-count")).toContainText(`${CAP + 2} / ${CAP}`);
  });

  test("the text is 16px on a phone and the box starts left-to-right-agnostic (dir=auto)", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/contact");
    const box = page.locator("#message");
    expect(await box.evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
    await expect(box).toHaveAttribute("dir", "auto");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });

  test("is a writing box: at least 4 rows tall with a resize handle", async ({ page }) => {
    const box = page.locator("#message");
    expect(await box.evaluate((el) => getComputedStyle(el).resize)).toBe("vertical");
    const lineHeight = await box.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
    expect((await box.boundingBox())!.height).toBeGreaterThan(lineHeight * 4);
  });
});
