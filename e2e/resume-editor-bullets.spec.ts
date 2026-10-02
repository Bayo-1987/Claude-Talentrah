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

  /*
   * Replace the achievement with two typed ones, starting from a KEYBOARD select-all, not from a caret placed
   * by hand. This used to put the caret at the end of the existing text by setting the DOM selection from the
   * test and then pressing Enter. That is a race (send-505, measured: 4 of 30 runs on a production build of
   * main, and on main's own push run 581717b): ProseMirror keeps its OWN selection state and only learns of a
   * DOM selection change from a later `selectionchange` event, so an Enter pressed before that event splits the
   * paragraph at ProseMirror's old caret, the START: ["", "ZQTWO ...ZQONE ..."]. A real mouse click followed by
   * an immediate Enter does the same (19 of 20 with no pause, 0 of 20 after 100 ms), and a frame or two of
   * waiting is not enough either (1 of 40). No person presses Enter within a millisecond of clicking, so this is
   * a test problem, not an editor one. Mod-A is handled by ProseMirror's own keydown, from its own state, so
   * there is no DOM selection for it to be late about (0 of 100).
   * e2e/resume-editor-caret-race.spec.ts reproduces the old failure deterministically.
   */
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("ZQONE Led the migration of the settlement ledger.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("ZQTWO Cut the close from nine days to four.");

  // Two paragraphs: two <li>, the control reads on, and it cannot be switched
  // off because that would mean merging two achievements into one string.
  await expect(page.locator("ul li", { hasText: "ZQONE" })).toHaveCount(1);
  await expect(page.locator("ul li", { hasText: "ZQTWO" })).toHaveCount(1);
  await expect(control).toHaveAttribute("aria-pressed", "true");
  await expect(control).toBeDisabled();
});
