/**
 * QA journey (chips E, #808): the Farah panel at 1366x768 as a person meets it, with a screenshot at every step for the report.
 * Arrival on a listed page (/billing): Farah's input fully inside the window, at most three chips, no "More questions" yet on a listed page's own chips; arrival on an
 * unlisted page (/settings); after the first message: one collapsed "Ask about this page" row, the input still in view; the row opened; closed again.
 * Behaviour is asserted in e2e/farah-chips-layout.spec.ts; this one is the evidence pack (it asserts only what each screenshot is of).
 */
import { test, expect, grantTestCredits, requireStubbedLlm } from "./fixtures/authed";

test.use({ viewport: { width: 1366, height: 768 } });

test("Farah chips: arrival, first message, collapsed row, opened row (screenshots)", async ({ authedPage: page, testUser }, info) => {
  const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: false }), contentType: "image/png" });
  await requireStubbedLlm(page);
  await grantTestCredits(testUser.id, 200);

  await page.goto("/billing");
  await expect(page.getByText("3 free messages left.")).toBeVisible();
  const input = page.getByPlaceholder("Ask me anything…");
  const box = await input.boundingBox();
  expect(box!.y + box!.height, "input fully inside 768px").toBeLessThanOrEqual(768);
  const chipCount = await page.getByRole("button", { name: /credits|pack or pass|free, and when/i }).count();
  expect(chipCount, "at most three chips before a chat").toBeLessThanOrEqual(3);
  await shot("1-billing-arrival");

  await page.goto("/settings");
  await expect(page.getByText("3 free messages left.")).toBeVisible();
  await shot("2-settings-arrival");

  await page.goto("/billing");
  await page.getByRole("button", { name: "What can I do with my credits?" }).click();
  await expect(page.getByText("2 free messages left.")).toBeVisible({ timeout: 30_000 });
  const row = page.getByRole("button", { name: "Ask about this page" });
  await expect(row).toBeVisible();
  await shot("3-after-first-message-collapsed-row");

  await row.click();
  await expect(row).toHaveAttribute("aria-expanded", "true");
  await shot("4-row-opened");
  await row.click();
  await expect(row).toHaveAttribute("aria-expanded", "false");
  await shot("5-row-closed-again");
});
