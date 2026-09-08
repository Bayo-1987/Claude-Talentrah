import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "../src/lib/supabase/types";

/**
 * The whole password-recovery loop, on its own throwaway account.
 *
 * NOT THE DEMO ACCOUNT, and that is not fastidiousness: this test's entire
 * purpose is to CHANGE a password and prove the old one stops working. Run
 * against demo@talentrah.dev it would rotate the credential that every other
 * signed-in spec logs in with, and the damage would surface as unrelated
 * suites failing to authenticate long after this file had passed.
 *
 * ── WHAT IS REAL HERE, AND THE ONE HOP THAT IS NOT ───────────────────────
 *
 * There is no inbox in CI, so the recovery token comes from
 * `admin.generateLink({ type: "recovery" })` and is redeemed with the same
 * `verifyOtp` + cookie-jar pattern the resume-upload and RLS suites use. That
 * produces a REAL recovery session, from Supabase, for this user, which is
 * exactly what /reset-password requires.
 *
 * The hop it does not exercise is /auth/callback's code exchange, and the
 * reason is worth writing down because the obvious version of this test looks
 * like it does and silently does not. Following `link.properties.action_link`
 * directly lands on
 *
 *   /login?error=auth_callback_failed#access_token=...&type=recovery
 *
 * — measured, not guessed. An admin-minted link is not bound to a PKCE code
 * challenge, so Supabase's verify endpoint answers it in the IMPLICIT flow and
 * returns tokens in the URL FRAGMENT. The callback looks for `?code=`, finds
 * none, and correctly reports failure. That is the callback behaving properly
 * against a link the real flow never produces: `resetPasswordForEmail` is
 * called from the SSR server client, which sends a code challenge, so the
 * emailed link comes back as `?code=` and exchanges normally — the same
 * mechanism signup confirmation and OAuth already use in production.
 *
 * So this file covers the request step, the reset step, and the credential
 * actually changing. The code exchange is covered where it is real.
 */

const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

if (process.env.CI && (!SERVICE || !SUPA_URL)) {
  throw new Error("forgot-password spec cannot run in CI without Supabase credentials");
}

const admin =
  SERVICE && SUPA_URL && !SERVICE.startsWith("PASTE")
    ? createClient<Database>(SUPA_URL, SERVICE, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;

/*
 * GENERATED, NOT WRITTEN DOWN. The first version assigned these as string
 * literals and the secret scan refused the PR — correctly, under the
 * `talentrah-hardcoded-credential` rule, which deliberately has no entropy
 * floor because a human-typed password is low-entropy by design.
 *
 * Interpolating is not a way around the rule, it is the shape the rule
 * documents as legitimate: a value built at runtime is a generated value, not
 * a secret, and `$` inside the literal is exactly what the pattern excludes.
 * It is also better for what this file does — every run now creates and
 * destroys an account whose credentials existed only for that run.
 *
 * Both satisfy isPasswordValid: the prefix supplies the uppercase and
 * lowercase, the UUID the length, and the trailing digit is guaranteed rather
 * than hoped for — a hex slice can legitimately contain no digit at all.
 */
const OLD_PASSWORD = `Old${randomUUID().slice(0, 12)}1`;
const NEW_PASSWORD = `New${randomUUID().slice(0, 12)}2`;

test.describe("forgotten password", () => {
  test.skip(!admin, "no usable SUPABASE_SERVICE_ROLE_KEY — this spec mints its own account");

  /**
 * Turn a recovery token into a real browser session.
 *
 * Extracted rather than duplicated when a second test needed it: this is the
 * only part of the reset flow that cannot be driven through the UI (see the
 * file header for why following `action_link` directly does not work), so a
 * second copy would be a second place for that subtlety to rot.
 *
 * Redeemed through Supabase and handed to the browser as cookies — the pattern
 * resume-upload.spec.ts and the RLS suites already use.
 */
async function applyRecoverySession(
  page: import("@playwright/test").Page,
  baseURL: string,
  tokenHash: string,
): Promise<void> {
  const jar = new Map<string, string>();
  const captured: { name: string; value: string }[] = [];
  const ssr = createServerClient(SUPA_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (list) => {
        for (const c of list) {
          jar.set(c.name, c.value);
          captured.push({ name: c.name, value: c.value });
        }
      },
    },
  });
  const { error: otpErr } = await ssr.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
  if (otpErr) throw otpErr;
  expect(captured.length, "verifyOtp produced no session cookie").toBeGreaterThan(0);

  await page.context().addCookies(
    captured.map((c) => ({ name: c.name, value: c.value, url: baseURL })),
  );
}

test("the whole loop: request, reset, and the old password stops working", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(120_000);

    const email = `reset-${randomUUID()}@talentrah.test`;
    const { data: created, error: createErr } = await admin!.auth.admin.createUser({
      email,
      password: OLD_PASSWORD,
      email_confirm: true,
    });
    if (createErr) throw createErr;
    const userId = created.user.id;

    try {
      // ── The old password works to begin with ───────────────────────────
      // Asserted FIRST, so "the old password no longer works" at the end
      // cannot pass because it never worked.
      await page.goto("/login");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password", { exact: true }).fill(OLD_PASSWORD);
      await page.getByRole("button", { name: "Log in" }).click();
      /*
       * /onboarding, not /jobs, and that is the correct destination rather
       * than a concession: every authenticated entry point now lands there,
       * and this account is created straight through the admin API with no
       * base resume and no skip marker, so /onboarding has something to show
       * it and does not bounce.
       *
       * The other 21 specs that drive this same form still wait on /jobs, and
       * still pass, because they sign in as the seeded demo account — which
       * HAS a base resume, so /onboarding hands it straight on. This file is
       * the only one that mints a fresh account, which is why it is the only
       * one that noticed.
       *
       * What this test is about is unchanged: reaching the app at all proves
       * the credential worked, which is the assertion that matters here.
       */
      await page.waitForURL("**/onboarding**");

      /*
       * Signed out by clearing cookies rather than by driving the account
       * menu. The menu route hung this test at the two-minute cap: it means
       * loading a page, opening a disclosure and waiting on a Server Action,
       * none of which is what this file is about. Dropping the session
       * cookie is the same end state with none of the machinery, and a
       * failure here would now be about password recovery rather than about
       * a dropdown.
       */
      await page.context().clearCookies();

      // ── The link out of the login form ─────────────────────────────────
      await page.goto("/login");
      await page.getByRole("link", { name: "Forgot password?" }).click();
      await page.waitForURL("**/forgot-password");

      // ── Requesting a reset ─────────────────────────────────────────────
      await page.getByLabel("Email").fill(email);
      await page.getByRole("button", { name: "Send reset link" }).click();
      await page.waitForURL("**/forgot-password/check-email**");
      await expect(page.getByText("If an account exists for")).toBeVisible();

      // ── Redeeming the recovery token Supabase would have emailed ───────
      const { data: link, error: linkErr } = await admin!.auth.admin.generateLink({
        type: "recovery",
        email,
      });
      if (linkErr || !link) throw linkErr ?? new Error("no recovery link returned");

      await applyRecoverySession(page, baseURL!, link.properties.hashed_token);

      await page.goto("/reset-password");
      await expect(page.getByRole("heading", { name: "Set a new password." })).toBeVisible();
      await expect(page.getByText(email)).toBeVisible();

      // ── Setting the new one ────────────────────────────────────────────
      await page.getByLabel("New password").fill(NEW_PASSWORD);
      await page.getByRole("button", { name: "Set new password" }).click();
      /*
       * /onboarding, not /jobs — completing a reset hands back a live session,
       * so it routes through the same gate every other entry point uses. This
       * account has no base resume and no skip marker, so the gate keeps it.
       * A user who already has either still lands on /jobs; the test directly
       * below this one pins that half.
       */
      await page.waitForURL("**/onboarding**");

      // ── And the credential actually changed ────────────────────────────
      await page.context().clearCookies();
      await page.goto("/login");

      // The old password is refused…
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password", { exact: true }).fill(OLD_PASSWORD);
      await page.getByRole("button", { name: "Log in" }).click();
      await expect(page.getByText("Incorrect email or password.")).toBeVisible();

      // …and the new one works.
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password", { exact: true }).fill(NEW_PASSWORD);
      await page.getByRole("button", { name: "Log in" }).click();
      await page.waitForURL("**/onboarding**");
    } finally {
      // Checked, not fired and forgotten — a refused delete RESOLVES with an
      // error rather than throwing, which is how this repo accumulated test
      // accounts for weeks while every hook reported success.
      const { error } = await admin!.auth.admin.deleteUser(userId);
      if (error) console.error("[forgot-password cleanup]", error.message);
    }
  });

  test("a reset by a user who ALREADY onboarded still lands on /jobs", async ({
    page,
    baseURL,
  }) => {
    /*
     * The other half of the gate, and the one that makes the change above safe
     * to ship. Routing a reset through /onboarding would be a regression if it
     * meant every established user met an upload prompt after recovering their
     * password — so this pins that it does not.
     *
     * Identical to the account in the test above in every respect except a
     * skip marker, which is exactly the difference the gate reads. A base
     * resume would do just as well; the marker is used because it is the half
     * that cannot be inferred from anything else, and therefore the half a
     * naive reimplementation would drop.
     */
    const email = `reset-onb-${randomUUID()}@talentrah.test`;
    const { data: created, error: createErr } = await admin!.auth.admin.createUser({
      email,
      password: OLD_PASSWORD,
      email_confirm: true,
    });
    if (createErr) throw createErr;
    const userId = created.user.id;

    try {
      const { error: markErr } = await admin!
        .from("profiles")
        .update({ onboarding_skipped_at: new Date().toISOString() })
        .eq("id", userId);
      // Checked: a refused Supabase update RESOLVES rather than throwing, and
      // an unset marker here would make this test pass for the wrong reason
      // by simply never reaching the branch it claims to cover.
      if (markErr) throw new Error(`could not set the skip marker: ${markErr.message}`);

      const { data: link, error: linkErr } = await admin!.auth.admin.generateLink({
        type: "recovery",
        email,
      });
      if (linkErr || !link) throw linkErr ?? new Error("no recovery link returned");

      await applyRecoverySession(page, baseURL!, link.properties.hashed_token);

      await page.goto("/reset-password");
      await page.getByLabel("New password").fill(NEW_PASSWORD);
      await page.getByRole("button", { name: "Set new password" }).click();

      // Straight through: the gate ran and handed this account on, because it
      // has already answered the question onboarding asks.
      await page.waitForURL("**/jobs");
      await expect(page.getByRole("button", { name: "Choose a file" })).toHaveCount(0);
    } finally {
      const { error } = await admin!.auth.admin.deleteUser(userId);
      if (error) console.error("[forgot-password onboarded cleanup]", error.message);
    }
  });

  test("the confirmation says the same thing for an address with no account", async ({
    page,
  }) => {
    /*
     * THE ANTI-ENUMERATION ASSERTION, and the reason it is a separate test:
     * the loop above proves the flow works for a real account, and proving the
     * flow is USELESS as an account oracle needs an address that is definitely
     * not one. Same page, same wording, same URL — any difference here is the
     * leak.
     */
    const strangerEmail = `definitely-not-registered-${randomUUID()}@talentrah.test`;

    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(strangerEmail);
    await page.getByRole("button", { name: "Send reset link" }).click();

    await page.waitForURL("**/forgot-password/check-email**");
    await expect(page.getByText("If an account exists for")).toBeVisible();
    await expect(page.getByRole("heading", { name: "On its way." })).toBeVisible();

    /*
     * Scoped to the confirmation itself, not the page. The first version read
     * document.body and tripped on the AuthHero's marketing copy beside it —
     * "free, no account needed to preview" — which is a sentence about signing
     * up, not about this address. A leak test that fires on unrelated words is
     * a leak test nobody will trust the second time.
     */
    const confirmation = (
      await page.getByTestId("reset-confirmation").innerText()
    ).toLowerCase();
    for (const leak of ["no account", "not found", "doesn't exist", "unregistered", "isn't registered"]) {
      expect(
        confirmation,
        `the confirmation leaks account existence via "${leak}"`,
      ).not.toContain(leak);
    }
  });

  test("/reset-password without a session sends you back to the start", async ({ page }) => {
    /*
     * The expired-link and typed-the-URL cases, which are the same case. A
     * form rendered here would take a new password and have nowhere to put it.
     */
    await page.goto("/reset-password");
    await page.waitForURL("**/forgot-password**");
    await expect(page.getByText("That reset link has expired")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send reset link" })).toBeVisible();
  });
});
