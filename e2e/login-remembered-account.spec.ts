import { test, expect } from "@playwright/test";
import {
  REMEMBERED_KEY,
  createPasswordUser,
  deletePasswordUser,
  everythingStored,
  signInThroughForm,
  signOutSeeker,
  storedEmail,
  submitLoginForm,
  waitForHydration,
  type PasswordUser,
} from "./support/remembered-account";

/**
 * "Continue as <email>" on the sign-in page (LOGIN-REMEMBERED-ACCOUNT-1).
 *
 * A convenience only: the card pre-fills the Email field from one localStorage value. It must never change how anyone is authenticated,
 * so most of what is pinned here is the negative space: nothing is stored on a failed sign-in, nothing is stored but an email, a page with
 * blocked storage behaves exactly as before, and the ordinary form is untouched when nothing is remembered.
 */
test.use({ viewport: { width: 1280, height: 900 } });

let user: PasswordUser;
test.beforeEach(async () => {
  user = await createPasswordUser();
});
test.afterEach(async () => {
  await deletePasswordUser(user.id);
});

test("a) nothing stored: the page is exactly the ordinary sign-in page", async ({ page }) => {
  await page.goto("/login");
  await waitForHydration(page);
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
  await expect(page.getByTestId("remembered-account")).toHaveCount(0);
  await expect(page.getByText("Continue as")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /use another account/i })).toHaveCount(0);
  expect(await storedEmail(page)).toBeNull();
});

test("b) after a successful sign-in and sign-out the card appears; tapping it fills the email and lands in the password field", async ({
  page,
}) => {
  await signInThroughForm(page, user.email, user.password);
  expect(await storedEmail(page)).toBe(user.email);

  await signOutSeeker(page);
  // Sign-out must not forget it.
  expect(await storedEmail(page)).toBe(user.email);

  await page.goto("/login");
  const card = page.getByTestId("remembered-account");
  await expect(card).toBeVisible();
  await expect(card.getByRole("button", { name: `Continue as ${user.email}` })).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveCount(0);
  await waitForHydration(page);

  await card.getByRole("button", { name: `Continue as ${user.email}` }).click();
  await expect(page.getByTestId("remembered-account")).toHaveCount(0);
  await expect(page.getByLabel("Email")).toHaveValue(user.email);
  await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");

  // Convenience, not authentication: the person still has to type the password and sign in.
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));

  // The one value is an email: no password, token or session id anywhere in storage.
  const stored = await everythingStored(page);
  expect(stored).not.toContain(user.password);
  expect(await page.evaluate(() => Object.keys(window.localStorage).filter((k) => k.startsWith("talentrah.")))).toEqual([REMEMBERED_KEY]);
});

test("c) 'Use another account' removes the card and the stored email, empties the form, and a reload shows no card", async ({ page }) => {
  await page.addInitScript(
    ([k, v]) => {
      try {
        if (!window.sessionStorage.getItem("seeded")) {
          window.localStorage.setItem(k, v);
          window.sessionStorage.setItem("seeded", "1");
        }
      } catch {}
    },
    [REMEMBERED_KEY, user.email],
  );
  await page.goto("/login");
  await waitForHydration(page);
  await expect(page.getByTestId("remembered-account")).toBeVisible();
  await expect(page.getByText("Not you?")).toBeVisible();

  await page.getByRole("button", { name: /use another account/i }).click();
  await expect(page.getByTestId("remembered-account")).toHaveCount(0);
  await expect(page.getByLabel("Email")).toHaveValue("");
  await expect(page.getByLabel("Email")).toBeVisible();
  expect(await storedEmail(page)).toBeNull();

  await page.reload();
  await waitForHydration(page);
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByTestId("remembered-account")).toHaveCount(0);
});

test("d) a failed sign-in stores nothing, and never overwrites what is remembered", async ({ page }) => {
  // Nothing remembered: a wrong password stores nothing.
  await page.goto("/login");
  await waitForHydration(page);
  await submitLoginForm(page, user.email, "definitely-not-the-password");
  await expect(page.getByText("Incorrect email or password.")).toBeVisible();
  expect(await storedEmail(page)).toBeNull();

  // Something remembered: a failed attempt as a DIFFERENT email leaves the remembered one alone.
  await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [REMEMBERED_KEY, user.email]);
  await page.goto("/login");
  await waitForHydration(page);
  await page.getByRole("button", { name: `Continue as ${user.email}` }).click();
  await page.getByLabel("Email").fill("someone-else@example.com");
  await page.getByLabel("Password", { exact: true }).fill("wrong-password-again");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("Incorrect email or password.")).toBeVisible();
  expect(await storedEmail(page)).toBe(user.email);
});

test("e) blocked storage: the page and the form behave exactly as before", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });
  });

  await page.goto("/login");
  await waitForHydration(page);
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByTestId("remembered-account")).toHaveCount(0);

  // A failed attempt still reports its error...
  await submitLoginForm(page, user.email, "wrong-password");
  await expect(page.getByText("Incorrect email or password.")).toBeVisible();
  // ...and a good one still signs in.
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  expect(errors, errors.join("\n")).toEqual([]);
});

test("g) starting a Google sign-in forgets the remembered email, so the card is not offered after a sign-in that was not by email", async ({
  page,
}) => {
  await page.goto("/login");
  await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [REMEMBERED_KEY, user.email]);
  await page.goto("/login");
  await waitForHydration(page);
  await expect(page.getByTestId("remembered-account")).toBeVisible();

  // Never reach Google (or even the identity provider): any document off this app is answered locally.
  await page.route(/^(?!http:\/\/localhost).*/, (route) =>
    route.request().resourceType() === "document"
      ? route.fulfill({ status: 200, contentType: "text/html", body: "stub" })
      : route.continue(),
  );
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.waitForURL((u) => u.hostname !== "localhost" || !u.pathname.startsWith("/login"));

  await page.goto("/login");
  await waitForHydration(page);
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByTestId("remembered-account")).toHaveCount(0);
  expect(await storedEmail(page)).toBeNull();
});

test("h) a full page load away while a sign-in is still in flight never writes the email", async ({ page }) => {
  // Hold the server action's POST so the form is guaranteed to still be waiting for an answer when the person leaves.
  // A CLIENT-side navigation cannot be used here: Next queues it behind a pending server action, so the form never unmounts mid-flight (found by tracing it).
  // That half, "the form unmounts with its submit unanswered", is pinned deterministically in tests/auth/remembered-account-wiring.test.tsx.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/login", async (route) => {
    if (route.request().method() === "POST" && route.request().headers()["next-action"] !== undefined) await gate;
    await route.continue().catch(() => {}); // the page has navigated away by then, so the request may already be gone
  });

  await page.goto("/login");
  await waitForHydration(page);
  await submitLoginForm(page, user.email, "wrong-password-held-in-flight");
  await expect(page.getByRole("button", { name: "Logging in…" })).toBeVisible();

  await page.goto("/signup");
  release();

  expect(await storedEmail(page)).toBeNull();
});
