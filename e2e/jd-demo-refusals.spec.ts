/**
 * P1 — every way the homepage demo can turn a visitor away shows the REASON and a WAY FORWARD in the browser,
 * and the page's free claim is the scoped one.
 *
 * Signed out and database-free (imports nothing from ./fixtures): the route is answered with each refusal body
 * the real route sends, so this pins what the client does with each `reason`, not the limiter (that is
 * tests/demo/anonymous-limit.test.ts and e2e/jd-demo.spec.ts). The messages are the ones from
 * src/lib/demo/refusal-copy.ts, spelled out here on purpose: a test that imported them would pass if both
 * sides changed together.
 */
import { test, expect } from "@playwright/test";

const JD = "Senior product designer. Own end-to-end design for our marketplace. 5+ years of Figma and user research. ".repeat(2);

const CASES: Array<{ reason: string; status: number; message: string }> = [
  { reason: "already_used", status: 403, message: "You've used your free preview — create a free account to keep going." },
  {
    reason: "daily_cap",
    status: 429,
    message: "Today's free previews are used up (we allow 5 a day) — create a free account to keep going, or try again tomorrow.",
  },
  {
    reason: "no_identifier",
    status: 503,
    message: "The free preview isn't available right now — try again in a moment, or create a free account to keep going.",
  },
  {
    reason: "error",
    status: 503,
    message: "The free preview isn't available right now — try again in a moment, or create a free account to keep going.",
  },
];

test("the homepage caption is the scoped free claim", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("jd-demo-caption")).toHaveText("Try it free — no account needed. One free preview per visitor.");
});

for (const c of CASES) {
  test(`refused (${c.reason}): shows its reason and a link to create a free account`, async ({ page }) => {
    await page.route("**/api/public/jd-demo", (route) =>
      route.fulfill({
        status: c.status,
        contentType: "application/json",
        // the body the real route sends: the wording comes from the server, so also test the client's own fallback below
        body: JSON.stringify({ error: c.message, reason: c.reason, runConsumed: false }),
      }),
    );
    await page.goto("/");
    await page.getByLabel("Job description").fill(JD);
    await page.getByRole("button", { name: "Send to Farah" }).click();
    await expect(page.getByText(c.message, { exact: true })).toBeVisible();
    const link = page.getByRole("link", { name: /Create a free account/ }).first();
    await expect(link).toBeVisible();
    expect(await link.getAttribute("href")).toBe("/signup");
  });

  test(`refused (${c.reason}): a response with no wording still renders the reason (never an empty box)`, async ({ page }) => {
    await page.route("**/api/public/jd-demo", (route) =>
      route.fulfill({ status: c.status, contentType: "application/json", body: JSON.stringify({ reason: c.reason }) }),
    );
    await page.goto("/");
    await page.getByLabel("Job description").fill(JD);
    await page.getByRole("button", { name: "Send to Farah" }).click();
    await expect(page.getByText(c.message, { exact: true })).toBeVisible();
  });
}
