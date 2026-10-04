/**
 * The password rule checklist in a real browser (signup): the states are readable, distinguishable without colour, and do not move the layout.
 *
 * The markup and contrast are pinned in tests/auth/password-requirements-checklist.test.tsx; this is the part only a browser can answer:
 * whether the list takes the same room in every state while someone types, and what an assistive technology would read.
 */
import { test, expect } from "@playwright/test";

const RULES = ["At least 8 characters", "One uppercase letter", "One lowercase letter", "One number"];

test("the checklist does not change height or move the form while a password is typed", async ({ page }) => {
  await page.goto("/signup");
  const list = page.locator("ul").filter({ hasText: RULES[0] });
  const submit = page.getByRole("button", { name: "Create a free account" });
  await expect(list).toBeVisible();
  // The page's own coordinates (viewport top plus scroll), so the browser scrolling the focused field into view is not read as the form moving.
  const pageTop = (loc: typeof list) => loc.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  const box = async () => ({ list: await list.boundingBox(), submit: { y: await pageTop(submit) } });
  const before = await box();
  const field = page.getByLabel("Password", { exact: true });
  // every rule flips state on the way: none -> lowercase -> + uppercase -> + number -> + length
  for (const typed of ["a", "aB", "aB1", "aB1xxxxx", ""]) {
    await field.fill(typed);
    const now = await box();
    expect(now.list!.height, `list height after typing "${typed}"`).toBe(before.list!.height);
    expect(now.submit!.y, `form position after typing "${typed}"`).toBe(before.submit!.y);
  }
});

test("each rule reads as met or not met to assistive technology, and the two states look different", async ({ page }) => {
  await page.goto("/signup");
  const item = (rule: string) => page.getByRole("listitem").filter({ hasText: rule });
  for (const rule of RULES) await expect(item(rule)).toContainText(`Not met: ${rule}`);
  await page.getByLabel("Password", { exact: true }).fill("aB1xxxxx");
  for (const rule of RULES) await expect(item(rule)).toContainText(`Met: ${rule}`);
  // the marker is a different shape in each state, not only a different colour
  await expect(item(RULES[0]).locator('svg[data-icon="check"]')).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill("");
  await expect(item(RULES[0]).locator('svg[data-icon="cross"]')).toBeVisible();
});

test("the rule that is not met has a visible marker at least 16px wide (not a faint dot)", async ({ page }) => {
  await page.goto("/signup");
  const marker = page.getByRole("listitem").filter({ hasText: RULES[1] }).locator("svg").first();
  const box = await marker.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(16);
  expect(box!.height).toBeGreaterThanOrEqual(16);
});
