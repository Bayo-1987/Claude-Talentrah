/**
 * Cover-letter generation used to have exactly one mention on the whole
 * Resume Builder page — a clause riding along inside the intro paragraph,
 * easy to skim past. This is the regression test for its replacement: a
 * "Generate a cover letter" card with equal visual weight to the resume
 * path, linking to /tailor.
 *
 * This is a visibility fix, not a capability fix — /tailor still requires a
 * real job description before Farah can tailor anything. This test only
 * proves the entry point exists and navigates; it does not claim /tailor
 * works with no job description, because that was explicitly out of scope.
 */
import { test, expect } from "./fixtures/authed";

test("Resume Builder surfaces a dedicated cover-letter entry point that links to /tailor", async ({
  authedPage,
}) => {
  await authedPage.goto("/resume-builder");

  await expect(authedPage.getByText("Two ways to start")).toBeVisible();
  await expect(authedPage.getByText("Generate a cover letter")).toBeVisible();
  await expect(authedPage.getByRole("heading", { name: "Tailor one to a real job" })).toBeVisible();

  await authedPage.getByRole("link", { name: "Tailor a cover letter →" }).click();
  await authedPage.waitForURL("/tailor");
});
