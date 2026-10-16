import { expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

/** Shared by the remembered-account specs (LOGIN-REMEMBERED-ACCOUNT-1). */
export const REMEMBERED_KEY = "talentrah.lastEmail";

export interface PasswordUser {
  id: string;
  email: string;
  password: string;
}

/** A throwaway user WITH a password (the authed fixture signs in by magic link and has none). Built at run time, never typed. */
export async function createPasswordUser(): Promise<PasswordUser> {
  const email = `e2e-${randomUUID()}@${randomUUID().slice(0, 12)}.talentrah.test`;
  const password = `Aa1!${randomUUID()}`;
  const { admin } = await import("../fixtures/authed"); // lazy: importing this file for forgetRememberedEmail must not build a database client
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  return { id: data.user.id, email, password };
}

export async function deletePasswordUser(id: string): Promise<void> {
  const { admin } = await import("../fixtures/authed");
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) throw new Error(`deleting test user ${id}: ${error.message}`);
}

/**
 * For every spec that is about something OTHER than the remembered-account card and that signs in through the form, signs out, and then visits /login again:
 * after a successful email sign-in /login now offers "Continue as <email>" instead of the form, which is the feature working, not those specs failing. This clears
 * talentrah.lastEmail before each of the page's documents runs, so such a spec sees the ordinary form exactly as it did before the card existed. Setup only: call it
 * before the first navigation. Specs ABOUT the card (login-remembered-account*.spec.ts) must not use it.
 */
export async function forgetRememberedEmail(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Storage blocked: nothing was remembered, which is the state wanted.
    }
  }, REMEMBERED_KEY);
}

/** The first React prop key on the form appears only once React has hydrated it; a submit before then is a plain no-JS post. */
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const el = document.querySelector("form") ?? document.body;
    return Object.keys(el).some((k) => k.startsWith("__reactProps"));
  });
}

export async function storedEmail(page: Page): Promise<string | null> {
  return page.evaluate((k) => window.localStorage.getItem(k), REMEMBERED_KEY);
}

/** Every key/value in local and session storage, as one string, to prove no password or token is ever kept there. */
export async function everythingStored(page: Page): Promise<string> {
  return page.evaluate(() => JSON.stringify([{ ...window.localStorage }, { ...window.sessionStorage }]));
}

export async function submitLoginForm(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
}

/** Sign in through the real form on /login and wait until the app has taken us away from it. */
export async function signInThroughForm(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await waitForHydration(page);
  await submitLoginForm(page, email, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

/** Retries the click until the app is interactive; the trigger is server-rendered and clickable before its handler exists. */
async function openMenu(page: Page, name: string) {
  await expect(async () => {
    await page.getByRole("button", { name }).click();
    await expect(page.getByRole("menu")).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

/** Sign out of the seeker app through the account menu, the way a person does. */
export async function signOutSeeker(page: Page): Promise<void> {
  await page.goto("/settings");
  await openMenu(page, "Account menu");
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/settings"));
}
