import { test, expect, type Page } from "@playwright/test";
import { REMEMBERED_KEY, waitForHydration } from "./support/remembered-account";

/**
 * Google One Tap must survive the remembered-account card (LOGIN-REMEMBERED-ACCOUNT-1, hard rule).
 *
 * The Google Identity Services script is answered with a stub that defines google.accounts.id.initialize / prompt as functions that
 * RECORD their calls and do nothing else, so no real Google sign-in ever happens. One Tap must initialise and prompt exactly once on
 * /login whether or not this browser remembers an email, and with the script blocked the page and the form must work as before.
 */
test.use({ viewport: { width: 1280, height: 900 } });

const STUB = `
window.__oneTap = { initialize: 0, prompt: 0, cancel: 0 };
window.google = { accounts: { id: {
  initialize: function () { window.__oneTap.initialize += 1; },
  prompt: function () { window.__oneTap.prompt += 1; },
  cancel: function () { window.__oneTap.cancel += 1; },
  disableAutoSelect: function () {},
} } };
`;

async function stubGsi(page: Page) {
  await page.route("https://accounts.google.com/gsi/client", (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: STUB }),
  );
}

const calls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __oneTap?: { initialize: number; prompt: number } }).__oneTap);

for (const remembered of [false, true]) {
  test(`One Tap initialises and prompts exactly once on /login ${remembered ? "with a remembered email" : "with nothing stored"}`, async ({
    page,
  }) => {
    // One Tap does nothing at all unless the app was BUILT with a client id (it is a NEXT_PUBLIC_ variable, read at build time), and CI
    // builds without one. Skipped there, by name and for that reason; run it with NEXT_PUBLIC_GOOGLE_CLIENT_ID set for both build and test.
    test.skip(
      !process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
      "NEXT_PUBLIC_GOOGLE_CLIENT_ID is not set, so the app under test was built with One Tap switched off",
    );
    await stubGsi(page);
    if (remembered) {
      await page.goto("/login");
      await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [REMEMBERED_KEY, "ada@example.com"]);
    }
    await page.goto("/login");
    await waitForHydration(page);

    await expect.poll(async () => (await calls(page))?.initialize).toBe(1);
    await expect.poll(async () => (await calls(page))?.prompt).toBe(1);
    // Give a second mount or a double effect time to show itself before calling it "once".
    await page.waitForTimeout(1000);
    expect(await calls(page)).toMatchObject({ initialize: 1, prompt: 1 });

    if (remembered) {
      await expect(page.getByRole("button", { name: "Continue as ada@example.com" })).toBeVisible();
      // Opening the form from the card does not re-run or cancel One Tap.
      await page.getByRole("button", { name: "Continue as ada@example.com" }).click();
      await expect(page.getByLabel("Email")).toHaveValue("ada@example.com");
      expect(await calls(page)).toMatchObject({ initialize: 1, prompt: 1 });
    } else {
      await expect(page.getByTestId("remembered-account")).toHaveCount(0);
    }
    // The separate "Continue with Google" button is still there, as it always was.
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  });
}

test("with the Google script blocked the page renders and the form works as before", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://accounts.google.com/gsi/client", (route) => route.abort());
  await page.goto("/login");
  await waitForHydration(page);

  await expect(page.getByLabel("Email")).toBeVisible();
  await page.getByLabel("Email").fill("nobody-e2e@talentrah.dev");
  await page.getByLabel("Password", { exact: true }).fill("whatever-wrong-password");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("Incorrect email or password.")).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveValue("nobody-e2e@talentrah.dev");
  expect(errors, errors.join("\n")).toEqual([]);
});
