import { test, expect, mintSecondSession } from "./fixtures/authed";
import type { Browser, BrowserContext, Page } from "@playwright/test";

/**
 * Sign-out scopes, end to end (S1-44). The header's "Sign out" signs out THIS device; "Sign out of all devices" in Settings signs out every
 * one. Two browser contexts are two devices: each holds its own session for the same account.
 *
 * Before the fix the header called `signOut()` with no argument, which is `scope: "global"`: signing out in one browser deleted the other's
 * session, and its next navigation went to /login. Production logs, 2026-10-02: every sign-out was `scope=global`, with 10 server-side
 * `refresh_token_not_found` in the same hours.
 */
async function secondDevice(browser: Browser, baseURL: string | undefined, cookie: { name: string; value: string }): Promise<{ context: BrowserContext; page: Page }> {
  const url = new URL(baseURL ?? "http://localhost:3000");
  const context = await browser.newContext();
  await context.addCookies([{ name: cookie.name, value: cookie.value, domain: url.hostname, path: "/", httpOnly: false, secure: url.protocol === "https:", sameSite: "Lax" }]);
  return { context, page: await context.newPage() };
}

async function openAccountMenu(page: Page) {
  await expect(async () => {
    await page.getByRole("button", { name: "Account menu" }).click();
    await expect(page.getByRole("menu")).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

test("signing out in one browser leaves the other signed in", async ({ authedPage, testUser, browser, baseURL }) => {
  const second = await secondDevice(browser, baseURL, await mintSecondSession(testUser));
  try {
    await authedPage.goto("/settings");
    await expect(authedPage.getByRole("heading", { name: "Your profile" })).toBeVisible();
    await second.page.goto("/settings");
    await expect(second.page.getByRole("heading", { name: "Your profile" })).toBeVisible();

    // sign out on the first device, through the account menu
    await openAccountMenu(authedPage);
    await authedPage.getByRole("menuitem", { name: "Sign out" }).click();
    await authedPage.waitForURL("**/login");

    // the second device is still signed in after navigating
    await second.page.goto("/billing");
    await expect(second.page).toHaveURL(/\/billing$/);
    await second.page.goto("/settings");
    await expect(second.page.getByRole("heading", { name: "Your profile" })).toBeVisible();
  } finally {
    await second.context.close();
  }
});

test("Sign out of all devices asks first, says what it does, and then signs out every browser", async ({ authedPage, testUser, browser, baseURL }) => {
  const second = await secondDevice(browser, baseURL, await mintSecondSession(testUser));
  try {
    await second.page.goto("/settings");
    await expect(second.page.getByRole("heading", { name: "Your profile" })).toBeVisible();

    await authedPage.goto("/settings");
    await authedPage.getByRole("button", { name: "Sign out of all devices" }).click();
    // the confirm step names the consequence before anything happens
    const warning = authedPage.getByRole("alert").filter({ hasText: "every device and browser, including this one" });
    await expect(warning).toBeVisible();
    await expect(authedPage).toHaveURL(/\/settings$/);
    // Cancel backs out without signing anyone out
    await authedPage.getByRole("button", { name: "Cancel" }).click();
    await expect(warning).toBeHidden();
    await second.page.goto("/billing");
    await expect(second.page).toHaveURL(/\/billing$/);

    await authedPage.getByRole("button", { name: "Sign out of all devices" }).click();
    await authedPage.getByRole("button", { name: "Sign out everywhere" }).click();
    await authedPage.waitForURL("**/login");

    await second.page.goto("/billing");
    await expect(second.page).toHaveURL(/\/login/);
  } finally {
    await second.context.close();
  }
});
