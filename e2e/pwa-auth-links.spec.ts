import { randomUUID } from "node:crypto";
import { test, expect, admin } from "./fixtures/authed";
import type { BrowserContext, Page } from "@playwright/test";
import { waitForWorkerControl } from "./support/pwa";
import { pkceClient, waitForMail, verifyLink, callbackUrlFor, giveVerifier } from "./support/auth-links";

/**
 * Authentication-link navigations with the worker ACTIVE and controlling the page (v2.1 section B).
 *
 * WHICH EMAIL LINKS EXIST. This app's signup confirmation is a six-digit code typed into the page (supabase/templates/confirmation.html), not a link,
 * so there is no signup-confirmation link to navigate. The links that reach /auth/callback with a `code` are the OAuth return, the password reset and an
 * emailed sign-in link; the sign-in link is used here as the plain code-exchange case (same route, same cookie write), and the reset link as the second.
 *
 * Real links, real codes: a PKCE sign-up or reset request on the local stack, the email from its mail catcher, and the `code` GoTrue mints (see
 * ./support/auth-links.ts). Each flow runs twice:
 *  1. online: the navigation reaches the server, the session cookie IS set in the browser, and the redirect lands where /auth/callback says;
 *  2. with the network cut AFTER the worker is active: the person sees the offline page (not a half-state), nothing was consumed (no session),
 *     and retrying online completes the flow exactly once (the code is single-use, so a replay would fail and a second visit shows it).
 */

const password = () => `Qa${randomUUID().replace(/-/g, "").slice(0, 14)}9`;
const newEmail = () => `pwa-${randomUUID()}@${randomUUID().slice(0, 10)}.talentrah.test`;
const hasSession = async (context: BrowserContext) => (await context.cookies()).some((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name));

async function installWorker(page: Page) {
  await page.goto("/about");
  await waitForWorkerControl(page);
}

test.describe("(B) /auth/callback with the worker active", () => {
  test("emailed sign-in link: the code exchange reaches the server, the session cookie is set, the redirect to next is followed", async ({ page, context, baseURL }) => {
    // An EXISTING user: for a new address Supabase sends the signup-confirmation (six-digit code) email instead of a link.
    const email = newEmail();
    const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password: password(), email_confirm: true });
    if (createErr) throw createErr;
    const { client, cookies } = pkceClient();
    const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: `${baseURL}/auth/callback?next=/onboarding` } });
    if (error) throw error;
    try {
      const callback = await callbackUrlFor(verifyLink(await waitForMail(email)));
      await giveVerifier(context, baseURL!, cookies());
      await installWorker(page);
      expect(await hasSession(context)).toBe(false);

      await page.goto(callback);
      expect(new URL(page.url()).pathname).toBe("/onboarding");
      await expect(page.getByRole("heading", { name: "You are offline." })).toHaveCount(0);
      expect(await hasSession(context), "the Set-Cookie on the callback response reached the browser").toBe(true);
    } finally {
      await admin.auth.admin.deleteUser(created.user.id);
    }
  });

  test("emailed sign-in link with the network cut: the offline page, nothing consumed, and the retry completes it exactly once", async ({ page, context, baseURL }) => {
    // An EXISTING user: for a new address Supabase sends the signup-confirmation (six-digit code) email instead of a link.
    const email = newEmail();
    const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password: password(), email_confirm: true });
    if (createErr) throw createErr;
    const { client, cookies } = pkceClient();
    const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: `${baseURL}/auth/callback?next=/onboarding` } });
    if (error) throw error;
    try {
      const callback = await callbackUrlFor(verifyLink(await waitForMail(email)));
      await giveVerifier(context, baseURL!, cookies());
      await installWorker(page);

      await context.setOffline(true);
      await page.goto(callback);
      await expect(page.getByRole("heading", { name: "You are offline." })).toBeVisible();
      expect(new URL(page.url()).pathname).toBe("/auth/callback");
      expect(await hasSession(context), "an offline attempt must not look signed in").toBe(false);

      await context.setOffline(false);
      await page.getByRole("link", { name: "Try again" }).click();
      await page.waitForURL("**/onboarding");
      expect(await hasSession(context)).toBe(true);

      // Exactly once: the code is spent, so a second visit to the same link is refused by the server, not silently re-run.
      await context.clearCookies({ name: /^sb-.*-auth-token(\.\d+)?$/ });
      await giveVerifier(context, baseURL!, cookies());
      await page.goto(callback);
      await expect(page).toHaveURL(/\/login\?error=auth_callback_failed/);
    } finally {
      await admin.auth.admin.deleteUser(created.user.id);
    }
  });

  async function resetFlow(page: Page, context: BrowserContext, baseURL: string, offlineFirst: boolean) {
    const email = newEmail();
    const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password: password(), email_confirm: true });
    if (createErr) throw createErr;
    try {
      const { client, cookies } = pkceClient();
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: `${baseURL}/auth/callback?next=/reset-password` });
      if (error) throw error;
      const callback = await callbackUrlFor(verifyLink(await waitForMail(email)));
      await giveVerifier(context, baseURL, cookies());
      await installWorker(page);

      if (offlineFirst) {
        await context.setOffline(true);
        await page.goto(callback);
        await expect(page.getByRole("heading", { name: "You are offline." })).toBeVisible();
        expect(await hasSession(context)).toBe(false);
        await context.setOffline(false);
        await page.getByRole("link", { name: "Try again" }).click();
      } else {
        await page.goto(callback);
      }
      // The reset hop lands on /reset-password (a stashed destination never redirects it), holding the recovery session.
      await page.waitForURL("**/reset-password");
      await expect(page.getByRole("heading", { name: "You are offline." })).toHaveCount(0);
      expect(await hasSession(context)).toBe(true);
      await expect(page).not.toHaveURL(/forgot-password/);
    } finally {
      await admin.auth.admin.deleteUser(created.user.id);
    }
  }

  test("password-reset link: lands on /reset-password with the recovery session", async ({ page, context, baseURL }) => {
    await resetFlow(page, context, baseURL!, false);
  });

  test("password-reset link with the network cut: the offline page, then the retry completes it", async ({ page, context, baseURL }) => {
    await resetFlow(page, context, baseURL!, true);
  });
});

test.describe("(B) /unsubscribe token link with the worker active", () => {
  async function userToken() {
    const email = newEmail();
    const { data, error } = await admin.auth.admin.createUser({ email, password: password(), email_confirm: true });
    if (error) throw error;
    const { data: pref, error: prefErr } = await admin.from("email_preferences").select("unsubscribe_token").eq("user_id", data.user.id).single();
    if (prefErr) throw prefErr;
    return { id: data.user.id, token: pref.unsubscribe_token };
  }

  test("the page loads and the token flow works unchanged", async ({ page }) => {
    const u = await userToken();
    try {
      await installWorker(page);
      const res = await page.goto(`/unsubscribe?token=${u.token}`);
      expect(res?.status()).toBe(200);
      await expect(page.getByText("That link didn't work.")).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "You are offline." })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "You're unsubscribed." })).toBeVisible();
    } finally {
      await admin.auth.admin.deleteUser(u.id);
    }
  });

  test("with the network cut: the offline page, and the retry online completes it", async ({ page, context }) => {
    const u = await userToken();
    try {
      await installWorker(page);
      await context.setOffline(true);
      await page.goto(`/unsubscribe?token=${u.token}`);
      await expect(page.getByRole("heading", { name: "You are offline." })).toBeVisible();
      await context.setOffline(false);
      await page.getByRole("link", { name: "Try again" }).click();
      await page.waitForURL(/\/unsubscribe\?token=/);
      await expect(page.getByRole("heading", { name: "You are offline." })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "You're unsubscribed." })).toBeVisible();
    } finally {
      await admin.auth.admin.deleteUser(u.id);
    }
  });
});
