import { test, expect } from "@playwright/test";

/**
 * /settings — the page "View profile" in the Farah panel has pointed at since
 * that link was written, and which did not exist. Every signed-in user hit a
 * 404 from every screen the panel renders on.
 *
 * The checked write is here from the first commit rather than after a second
 * bug report: a Supabase update that is REFUSED resolves with an `error`, so
 * without `.select()` and a row-count check a policy denial, a column-grant
 * denial and an expired session all look exactly like a save.
 *
 * The last test is the one that matters most and is easiest to lose: only
 * three of the six profile columns in the brief are writable. `email` and
 * `market_segment` were revoked by 0030 — the identity key and a billing
 * segment nobody self-selects — so they are shown as facts. A form field for
 * either would fail 42501 and be indistinguishable from a bug.
 */
const DEMO_PASSWORD = process.env.DEMO_PASSWORD;

if (process.env.CI && !DEMO_PASSWORD) {
  throw new Error("settings spec cannot run in CI: DEMO_PASSWORD is not set");
}

test.use({ viewport: { width: 1280, height: 950 } });

test.beforeEach(async ({ page }) => {
  test.skip(!DEMO_PASSWORD, "DEMO_PASSWORD is not set — see scripts/seed.ts");
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo@talentrah.dev");
  await page.getByLabel("Password").fill(DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/jobs");
});

test("the panel's View profile link resolves instead of 404ing", async ({ page }) => {
  const direct = await page.goto("/settings");
  expect(direct?.status()).toBe(200);

  await page.goto("/jobs");
  await page.getByRole("link", { name: "View profile" }).click();
  await page.waitForURL("**/settings");
  await expect(page.getByRole("heading", { name: "Your profile" })).toBeVisible();
});

test("a save lands, and the rest of the shell agrees with it", async ({ page }) => {
  await page.goto("/settings");
  const original = await page.getByLabel("First name").inputValue();
  const marker = `Demo${Date.now() % 10000}`;

  try {
    await page.getByLabel("First name").fill(marker);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Saved.")).toBeVisible({ timeout: 15000 });

    // The name is rendered by the (app) LAYOUT — masthead initials and the
    // Farah panel — not by this page. revalidatePath("/settings") alone would
    // leave the shell showing the old name, changed here and nowhere else.
    await expect(page.locator("div.border-l")).toContainText(marker);

    await page.reload();
    expect(await page.getByLabel("First name").inputValue()).toBe(marker);
  } finally {
    await page.getByLabel("First name").fill(original);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Saved.")).toBeVisible({ timeout: 15000 });
  }
});

test("a name with no visible characters is refused, not saved as blank", async ({ page }) => {
  await page.goto("/settings");
  const original = await page.getByLabel("First name").inputValue();

  // U+200B. `.trim()` does not remove it, so this is exactly the value that
  // used to pass validation and render as an empty name everywhere.
  await page.getByLabel("First name").fill("​");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByText("Enter your first name")).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Saved.")).toHaveCount(0);

  await page.reload();
  expect(await page.getByLabel("First name").inputValue()).toBe(original);
});

test("the columns a user may not change are shown as facts, not as fields", async ({ page }) => {
  await page.goto("/settings");

  // Present — "where is my email?" is a worse question than "why can't I
  // change it?", and the second has an answer printed beside it.
  await expect(page.getByText("demo@talentrah.dev")).toBeVisible();
  await expect(page.getByText("keyed on this address")).toBeVisible();
  await expect(page.getByText("Billing region")).toBeVisible();

  // …and not editable. A field here would fail 42501 at the database, which a
  // person cannot tell apart from the product being broken.
  const form = page.locator("form");
  await expect(form.locator('[name="email"]')).toHaveCount(0);
  await expect(form.locator('[name="market_segment"]')).toHaveCount(0);
  await expect(form.locator('[name="marketSegment"]')).toHaveCount(0);
  // locale is writable but nothing reads it — a picker would be a control
  // that silently does nothing.
  await expect(form.locator('[name="locale"]')).toHaveCount(0);
});
