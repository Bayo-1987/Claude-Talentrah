import { test, expect } from "@playwright/test";

/**
 * The Achievements field's "Bulleted list" control, driven in a real browser
 * on the QA-only editor fixture (/dev/resume-editor-fixture — no database, no
 * sign-in).
 *
 * The editor is paragraph-per-bullet, so two or more achievements are always a
 * list. What the control adds is the choice for a role with ONE achievement:
 * a prose line (how an imported or older resume starts), or a one-item
 * bulleted list. The live preview beside the form is the real template, so
 * "the preview has an <li>" is the same thing the PDF will contain.
 */

test("the Bulleted list control turns a single achievement into a real list item, and back", async ({ page }) => {
  await page.goto("/dev/resume-editor-fixture");

  const control = page.getByRole("button", { name: "Bulleted list" });
  const preview = page.locator("main, body").first();
  const listItem = preview.locator("ul li", { hasText: "ZQONE" });

  // Starts as a prose line: a paragraph in the preview, no list item.
  await expect(control).toBeVisible();
  await expect(control).toHaveAttribute("aria-pressed", "false");
  await expect(listItem).toHaveCount(0);

  // The control is a real hit target (>= 40x40).
  const box = await control.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(40);
  expect(box!.height).toBeGreaterThanOrEqual(40);

  await control.click();
  await expect(control).toHaveAttribute("aria-pressed", "true");
  await expect(listItem).toHaveCount(1);

  // The editor itself shows the bullet, not only the preview.
  const editorParagraph = page.getByRole("textbox", { name: "Achievements" }).locator("p").first();
  await expect(editorParagraph).toHaveCSS("display", "list-item");

  // Back to a prose line.
  await control.click();
  await expect(control).toHaveAttribute("aria-pressed", "false");
  await expect(listItem).toHaveCount(0);
});

test("two achievements are always a list, and the control stays on until only one is left", async ({ page }) => {
  await page.goto("/dev/resume-editor-fixture");

  const control = page.getByRole("button", { name: "Bulleted list" });
  const editor = page.getByRole("textbox", { name: "Achievements" });

  // Typing before the page has hydrated is typing into markup nothing is
  // listening to yet.
  await page.waitForLoadState("networkidle");
  await expect(control).toBeVisible();
  // Put the caret at the very end of the existing achievement. Clicking and
  // pressing End depends on where the click lands in a paragraph that wraps,
  // which moves with font loading; a DOM selection does not.
  await editor.focus();
  await editor.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el.lastElementChild!);
    range.collapse(false);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.keyboard.press("Enter");
  await page.keyboard.type("ZQTWO Cut the close from nine days to four.");

  // Two paragraphs: two <li>, the control reads on, and it cannot be switched
  // off because that would mean merging two achievements into one string.
  await expect(page.locator("ul li", { hasText: "ZQONE" })).toHaveCount(1);
  await expect(page.locator("ul li", { hasText: "ZQTWO" })).toHaveCount(1);
  await expect(control).toHaveAttribute("aria-pressed", "true");
  await expect(control).toBeDisabled();
});
