/**
 * /how-match-scores-work is the one explainer the match breakdown links to. It must read signed out: job pages are public,
 * and a link that bounced a reader to /login would be a dead end. It also has to say, in words, that an unstated seniority
 * is neutral (S3-23a).
 */
import { test, expect } from "@playwright/test";

test("signed OUT: the explainer is a real page, not a redirect to /login", async ({ page }) => {
  const res = await page.goto("/how-match-scores-work");
  expect(res?.status(), "signed-out request must not redirect or fail").toBe(200);
  expect(page.url()).toContain("/how-match-scores-work");
  await expect(page.getByRole("heading", { level: 1, name: "How match scores work" })).toBeVisible();
});

test("signed OUT: it says what is counted, what is not yet, what thin means, the three tiers, and that unknown seniority is neutral", async ({
  page,
}) => {
  await page.goto("/how-match-scores-work");
  const main = page.locator("main");
  await expect(main).toContainText("Skill tags");
  await expect(main).toContainText("Industry");
  await expect(main).toContainText("thin match");
  await expect(main).toContainText("Excellent");
  await expect(main).toContainText("Good");
  await expect(main).toContainText("Fair");
  await expect(main).toContainText(/seniority is\s+neutral/i);
  await expect(main).toContainText("neither adds to the score nor takes anything away");
});
