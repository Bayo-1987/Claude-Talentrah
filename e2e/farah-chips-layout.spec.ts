/**
 * Chip layout, option E (owner, 7 Oct 2026): before a chat starts at most three chips, and Farah's input is fully inside a 1366x768 laptop window; once a chat
 * has started the chips collapse to ONE row ("Ask about this page" on a page's own chips) that opens them, and the input is still in view.
 * The unit half (the cap, the collapsed render, no cost line, the describedby) is tests/farah/quick-actions-layout.test.tsx; this is the browser half, because
 * "the input is in the window" and "the row opens the chips" need a real layout and a real click. Runs against the stub LLM.
 *
 * NOT run locally (needs the database): this spec's first run is its CI run.
 */
import type { Page } from "@playwright/test";
import { test, expect, grantTestCredits, requireStubbedLlm } from "./fixtures/authed";

const WINDOW = { width: 1366, height: 768 };
const BILLING_CHIPS = ["What can I do with my credits?", "Which pack or pass suits me?", "What's free, and when does it renew?"];

async function inputIsInsideTheWindow(page: Page) {
  const box = await page.getByPlaceholder("Ask me anything…").boundingBox();
  expect(box, "the input has a box").not.toBeNull();
  expect(box!.y, "the input starts inside the window").toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height, `the input ends at ${box!.y + box!.height}px of ${WINDOW.height}`).toBeLessThanOrEqual(WINDOW.height);
}

test.describe("Farah chips on a laptop window", () => {
  test.use({ viewport: WINDOW });

  test("arrival on a listed page: its three chips, no More row, no cost line, and the input is inside 1366x768", async ({ authedPage: page, testUser }) => {
    await grantTestCredits(testUser.id, 200);
    await page.goto("/billing");
    await expect(page.getByText("3 free messages left.")).toBeVisible();
    for (const label of BILLING_CHIPS) await expect(page.getByRole("button", { name: label })).toBeVisible();
    await expect(page.getByRole("button", { name: "More questions" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ask about this page" })).toHaveCount(0);
    // No per-chip price: the allowance line says it once.
    await expect(page.getByText("included with your Pass")).toHaveCount(0);
    await inputIsInsideTheWindow(page);
  });

  test("arrival on an unlisted page: today's three chips, and the input is inside 1366x768", async ({ authedPage: page, testUser }) => {
    await grantTestCredits(testUser.id, 200);
    await page.goto("/settings");
    await expect(page.getByText("3 free messages left.")).toBeVisible();
    for (const label of ["Job Interview Prep", "Career Advisor", "Salary Negotiation"]) await expect(page.getByRole("button", { name: label })).toBeVisible();
    await inputIsInsideTheWindow(page);
  });

  test("after the first message the chips collapse to one row that opens them; the input stays in view", async ({ authedPage: page, testUser }) => {
    await requireStubbedLlm(page);
    await grantTestCredits(testUser.id, 200);
    await page.goto("/billing");
    await expect(page.getByText("3 free messages left.")).toBeVisible();

    await page.getByRole("button", { name: BILLING_CHIPS[0] }).click();
    await expect(page.getByText("2 free messages left.")).toBeVisible({ timeout: 30_000 });

    const row = page.getByRole("button", { name: "Ask about this page" });
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute("aria-expanded", "false");
    for (const label of BILLING_CHIPS) await expect(page.getByRole("button", { name: label })).toHaveCount(0);
    await inputIsInsideTheWindow(page);

    await row.click();
    await expect(row).toHaveAttribute("aria-expanded", "true");
    for (const label of BILLING_CHIPS) await expect(page.getByRole("button", { name: label })).toBeVisible();
    await inputIsInsideTheWindow(page);

    await row.click();
    await expect(row).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("button", { name: BILLING_CHIPS[1] })).toHaveCount(0);
  });

  test("choosing a chip from the opened list sends it and closes the list again", async ({ authedPage: page, testUser }) => {
    await requireStubbedLlm(page);
    await grantTestCredits(testUser.id, 200);
    await page.goto("/billing");
    await expect(page.getByText("3 free messages left.")).toBeVisible();
    await page.getByRole("button", { name: BILLING_CHIPS[0] }).click();
    await expect(page.getByText("2 free messages left.")).toBeVisible({ timeout: 30_000 });

    const row = page.getByRole("button", { name: "Ask about this page" });
    await row.click();
    await page.getByRole("button", { name: BILLING_CHIPS[1] }).click();
    await expect(page.getByText("1 free message left.")).toBeVisible({ timeout: 30_000 });
    await expect(row).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("button", { name: BILLING_CHIPS[2] })).toHaveCount(0);
  });
});
