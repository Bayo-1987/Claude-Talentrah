import { randomUUID } from "node:crypto";
import { test, expect, admin, seedBaseResume } from "./fixtures/authed";
import type { Page } from "@playwright/test";
import { waitForWorkerControl, cacheNames, cachedPaths } from "./support/pwa";
import { startFaultyOrigin } from "./support/faulty-origin";

/**
 * The flows that must keep working with the service worker ACTIVE and controlling the page (build prompt section 3, e2e a to e).
 *
 * The worker answers only a plain same-origin GET navigation and hands every other request to the browser untouched, so each test here proves a
 * real flow end to end with the worker installed first, and where it matters asserts WHO answered with `response.fromServiceWorker()`.
 * (Local stack or CI only: ./fixtures/authed's admin client refuses production.)
 */

const newPassword = () => `Qa${randomUUID().replace(/-/g, "").slice(0, 14)}9`;

async function openAccountMenu(page: Page) {
  await expect(async () => {
    await page.getByRole("button", { name: "Account menu" }).click();
    await expect(page.getByRole("menu")).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

test.describe("(a) email sign-in and sign-out", () => {
  test("through the real pages, with the worker active", async ({ page }) => {
    const email = `pwa-${randomUUID()}@${randomUUID().slice(0, 10)}.talentrah.test`;
    const password = newPassword();
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { first_name: "PWA", last_name: "Tester", country: "Nigeria" } });
    if (error) throw error;
    try {
      // A base resume, so sign-in lands on the feed and not on onboarding (as in e2e/journey-human-sign-in.spec.ts).
      await seedBaseResume(data.user.id);
      await page.goto("/login");
      await waitForWorkerControl(page);

      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Log in" }).click();
      await page.waitForURL("**/jobs", { timeout: 30_000 });
      expect(await page.evaluate(() => !!navigator.serviceWorker.controller), "still controlled after sign-in").toBe(true);

      // A plain navigation inside the signed-in app is answered by the worker (by the network, through it) and is the real page.
      const tracker = await page.goto("/tracker");
      expect(tracker?.status()).toBe(200);
      expect(tracker?.fromServiceWorker()).toBe(true);
      await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();

      await openAccountMenu(page);
      await page.getByRole("menuitem", { name: "Sign out" }).click();
      await page.waitForURL("**/login");

      // Signed out for real: a protected page sends the person to the login page again.
      await page.goto("/settings");
      await expect(page).toHaveURL(/\/login/);

      // After a full sign-in and sign-out the worker's cache holds the offline page and nothing a signed-in session ever read.
      expect(await cacheNames(page)).toEqual(["talentrah-offline-v1"]);
      expect(await cachedPaths(page, "talentrah-offline-v1")).toEqual(["/offline"]);
    } finally {
      await admin.auth.admin.deleteUser(data.user.id);
    }
  });
});

test.describe("(b) Google sign-in start", () => {
  test("the redirect to accounts.google.com still happens (the local stack has a fake Google provider; Google itself is never contacted)", async ({ page, context }) => {
    // Cross-origin navigations are not the worker's; this stops the browser sending a real request to Google.
    await context.route(/^https:\/\/accounts\.google\.com\//, (route) => route.abort());

    await page.goto("/login");
    await waitForWorkerControl(page);

    const hops: string[] = [];
    page.on("response", (r) => {
      if (r.status() >= 300 && r.status() < 400) hops.push(`${r.status()} ${r.url().split("?")[0]} -> ${(r.headers()["location"] ?? "").split("?")[0]}`);
    });
    const googleRequest = page.waitForRequest((r) => r.url().startsWith("https://accounts.google.com/o/oauth2/v2/auth"), { timeout: 30_000 });
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await googleRequest;

    // The server action redirected to GoTrue, which redirected to Google: both hops were reached, in order, and the worker answered neither.
    const authorize = hops.find((h) => h.includes("/auth/v1/authorize"));
    expect(authorize, `redirect hops seen: ${hops.join(" | ")}`).toBeDefined();
    expect(authorize).toMatch(/-> https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth$/);
  });
});

test.describe("(c) the Paystack return to /billing/callback", () => {
  test("is answered by the server, never by the worker, and works untouched", async ({ authedPage: page, testUser }) => {
    const reference = `TLR-E2E-PWA-${randomUUID().slice(0, 8)}`;
    const { data: pack } = await admin.from("credit_packs").select("id, price_ngn").eq("is_active", true).order("price_ngn").limit(1).single();
    // Already settled, exactly like e2e/billing-callback.spec.ts: fulfilment returns already_processed and takes the same redirect without calling Paystack.
    const { error } = await admin.from("payment_transactions").upsert(
      { user_id: testUser.id, product_type: "credit_pack", product_id: pack!.id, amount: pack!.price_ngn, currency: "NGN", status: "success", rail: "card", channel: "card", paystack_reference: reference },
      { onConflict: "paystack_reference" },
    );
    if (error) throw error;
    try {
      await page.goto("/jobs");
      await waitForWorkerControl(page);

      const callback = page.waitForResponse((r) => new URL(r.url()).pathname === "/billing/callback");
      await page.goto(`/billing/callback?reference=${reference}&trxref=${reference}`);
      const res = await callback;
      expect(res.fromServiceWorker(), "the payment return must reach the server untouched").toBe(false);

      await page.waitForURL("**/billing?purchased=1");
      await expect(page.getByText("Payment received").first()).toBeVisible();
      expect(page.url(), "the raw reference must not survive in the URL").not.toContain(reference);
      expect(await cachedPaths(page, "talentrah-offline-v1")).toEqual(["/offline"]);
    } finally {
      const { error: delErr } = await admin.from("payment_transactions").delete().eq("paystack_reference", reference);
      if (delErr) console.error("[pwa billing cleanup]", delErr.message);
    }
  });

  test("with the network cut, the return is NOT swallowed into a half-state: the offline page, and a retry once online completes it", async ({ authedPage: page, testUser, context }) => {
    const reference = `TLR-E2E-PWA-${randomUUID().slice(0, 8)}`;
    const { data: pack } = await admin.from("credit_packs").select("id, price_ngn").eq("is_active", true).order("price_ngn").limit(1).single();
    await admin.from("payment_transactions").upsert(
      { user_id: testUser.id, product_type: "credit_pack", product_id: pack!.id, amount: pack!.price_ngn, currency: "NGN", status: "success", rail: "card", channel: "card", paystack_reference: reference },
      { onConflict: "paystack_reference" },
    );
    try {
      await page.goto("/jobs");
      await waitForWorkerControl(page);
      await context.setOffline(true);
      // /billing/* is not the worker's: the browser itself fails the request, which is what the person would have seen without any worker.
      await expect(page.goto(`/billing/callback?reference=${reference}`)).rejects.toThrow(/ERR_INTERNET_DISCONNECTED/);
      await context.setOffline(false);
      await page.goto(`/billing/callback?reference=${reference}`);
      await page.waitForURL("**/billing?purchased=1");
      await expect(page.getByText("Payment received").first()).toBeVisible();
    } finally {
      await admin.from("payment_transactions").delete().eq("paystack_reference", reference);
    }
  });
});

test.describe("(d) a redirect is followed unchanged", () => {
  test("a navigation the server answers with a 307 to /login ends on /login, not on the offline page", async ({ page }) => {
    await page.goto("/about");
    await waitForWorkerControl(page);

    const res = await page.goto("/settings");
    expect(new URL(page.url()).pathname).toBe("/login");
    expect(new URL(page.url()).searchParams.get("redirectTo")).toBe("/settings");
    // The navigation that reached /login was redirected from /settings (the worker returned the 307 as it came).
    expect(res?.request().redirectedFrom()?.url()).toMatch(/\/settings$/);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: /Log in to Talentrah/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "You are offline." })).toHaveCount(0);
  });
});

test.describe("(e) a server error is delivered as the error", () => {
  test("a real 500 from the origin is the 500, not the offline page; a dropped connection IS the offline page", async ({ browser, baseURL }) => {
    const target = new URL(baseURL ?? "http://localhost:3000");
    const origin = await startFaultyOrigin({ host: target.hostname === "localhost" ? "127.0.0.1" : target.hostname, port: Number(target.port || 80) });
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(`${origin.url}/about`);
      await waitForWorkerControl(page);

      origin.fault = (req) => (req.url?.startsWith("/jobs?s4=fail") ? "500" : req.url?.startsWith("/jobs?s4=drop") ? "drop" : "pass");

      const failed = await page.goto(`${origin.url}/jobs?s4=fail`);
      expect(failed?.status()).toBe(500);
      expect(failed?.fromServiceWorker()).toBe(true);
      await expect(page.getByRole("heading", { name: "The origin failed on purpose" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "You are offline." })).toHaveCount(0);

      const dropped = await page.goto(`${origin.url}/jobs?s4=drop`);
      expect(dropped?.status()).toBe(200);
      await expect(page.getByRole("heading", { name: "You are offline." })).toBeVisible();
    } finally {
      await context.close();
      await origin.close();
    }
  });
});
