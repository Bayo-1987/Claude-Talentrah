import { test, expect } from "@playwright/test";

/**
 * send-505 — the root cause of the `resume-editor-bullets.spec.ts` flake, reproduced DETERMINISTICALLY.
 *
 * The old test positioned the caret by setting the browser's DOM selection and then pressing Enter. The editor
 * (TipTap on ProseMirror) keeps its own selection state, and only reads the DOM selection back on a later
 * `selectionchange` event. Do both in ONE task and no such event can have been delivered, so Enter splits at
 * ProseMirror's stale caret (the start) every time instead of one run in a few. That is what this pins: the
 * outcome the flaky runs produced, on demand, with no timing involved.
 *
 * It is a characterisation of the editor's input model, not a product requirement: it exists so that the next
 * person who writes "set the selection, then press Enter" in an e2e sees that this cannot be made reliable, and
 * why. If ProseMirror ever starts syncing the DOM selection synchronously on keydown this test will fail and the
 * helper comment in resume-editor-bullets.spec.ts can be relaxed.
 *
 * The fixed way (keyboard select-all, handled by ProseMirror itself) is asserted below, once per page load, in
 * a loop, so a regression back to a racy approach shows up here as a failure rather than as a rare flake.
 */

const ACHIEVEMENTS = { name: "Achievements" } as const;

test("DOM selection set and Enter pressed in the same task splits at the START: the flaky outcome, deterministically", async ({ page }) => {
  await page.goto("/dev/resume-editor-fixture");
  await page.waitForLoadState("networkidle");
  const editor = page.getByRole("textbox", ACHIEVEMENTS);
  await editor.focus();

  await editor.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el.lastElementChild!);
    range.collapse(false);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    // Same task: no `selectionchange` can have been delivered to ProseMirror yet.
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true }));
  });
  await page.keyboard.type("ZQTWO tail");

  const paragraphs = await editor.locator("p").allInnerTexts();
  // The caret was at the end as far as the DOM was concerned, yet the split happened at the start: an empty first
  // paragraph, and the typed text in front of the original text. Exactly the failure in main's CI.
  expect(paragraphs.map((p) => p.trim())).toEqual(["", "ZQTWO tailZQONE Led the migration of the settlement ledger."]);
});

test("keyboard select-all then typing two achievements gives two paragraphs, every time", async ({ page }) => {
  for (let i = 0; i < 10; i++) {
    await page.goto("/dev/resume-editor-fixture");
    await page.waitForLoadState("networkidle");
    const editor = page.getByRole("textbox", ACHIEVEMENTS);
    await editor.focus();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("ZQONE first");
    await page.keyboard.press("Enter");
    await page.keyboard.type("ZQTWO second");
    await expect(editor.locator("p")).toHaveText(["ZQONE first", "ZQTWO second"]);
  }
});
