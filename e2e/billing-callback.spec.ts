import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/types";

/**
 * What a payer sees after Paystack sends them back.
 *
 * ── THE BUG THIS PINS ─────────────────────────────────────────────────────
 *
 * /billing/callback used to fulfil the payment and then render its own
 * confirmation inline. The credits badge beside that confirmation comes from
 * (app)/layout.tsx, which calls requireUser() independently — a SIBLING
 * render, not something sequenced after the mutation. So the layout could read
 * and render the PRE-GRANT balance in the same response whose headline said
 * "You're all set."
 *
 * The redirect is the fix, and it is structural rather than careful: ending
 * the request means the layout's next read happens on a new one, strictly
 * after the grant committed. There is no ordering left to get wrong.
 *
 * WHAT THIS SPEC CAN AND CANNOT PROVE. It proves the redirect happens, that
 * the URL loses the raw Paystack reference, and that the confirmation names
 * the actual purchase. It does NOT reproduce a stale badge, because reaching
 * the granting path requires Paystack to verify a live pending transaction and
 * there is no Paystack in a test run — a fixture is necessarily already
 * settled, which returns `already_processed`. That is stated here rather than
 * implied by a passing test.
 */

const DEMO_PASSWORD = process.env.DEMO_PASSWORD;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

if (process.env.CI && !DEMO_PASSWORD) {
  throw new Error("billing-callback spec cannot run in CI: DEMO_PASSWORD is not set");
}

const admin =
  SERVICE && SUPA_URL && !SERVICE.startsWith("PASTE")
    ? createClient<Database>(SUPA_URL, SERVICE, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;

const REFERENCE = "TLR-E2E-CALLBACK-REDIRECT";

test.describe("returning from checkout", () => {
  test.skip(!DEMO_PASSWORD, "DEMO_PASSWORD is not set — see scripts/seed.ts");
  test.skip(!admin, "no usable SUPABASE_SERVICE_ROLE_KEY — this spec seeds its own receipt");

  test.beforeEach(async () => {
    const { data: profile } = await admin!
      .from("profiles")
      .select("id")
      .eq("email", "demo@talentrah.dev")
      .single();
    const { data: pack } = await admin!
      .from("credit_packs")
      .select("id, price_ngn")
      .eq("is_active", true)
      .order("price_ngn")
      .limit(1)
      .single();

    /*
     * `status: "success"`, i.e. already settled. fulfillPayment returns
     * `already_processed` for anything not pending and takes the same redirect
     * — without calling Paystack and without granting anything, so this
     * fixture cannot move a real balance.
     */
    await admin!.from("payment_transactions").upsert(
      {
        user_id: profile!.id,
        product_type: "credit_pack",
        product_id: pack!.id,
        amount: pack!.price_ngn,
        currency: "NGN",
        status: "success",
        rail: "card",
        channel: "card",
        paystack_reference: REFERENCE,
      },
      { onConflict: "paystack_reference" },
    );
  });

  test.afterEach(async () => {
    // Checked, not fired and forgotten. A rejected Supabase delete RESOLVES
    // with an error rather than throwing, which is how ten cleanup sites in
    // this repo reported success for weeks while deleting nothing.
    const { error } = await admin!
      .from("payment_transactions")
      .delete()
      .eq("paystack_reference", REFERENCE);
    if (error) console.error("[billing-callback cleanup]", error.message);
  });

  test("a settled payment redirects, and the confirmation names the purchase", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("demo@talentrah.dev");
    await page.getByLabel("Password").fill(DEMO_PASSWORD!);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("**/jobs");

    await page.goto(`/billing/callback?reference=${REFERENCE}`);

    // The redirect itself. A real request boundary is what makes the layout's
    // balance read trustworthy, so this assertion is the fix.
    await page.waitForURL("**/billing?purchased=1");
    expect(page.url(), "the raw Paystack reference must not survive in the URL").not.toContain(
      REFERENCE,
    );

    // Specific, not "your credits or pass have been added".
    const banner = page.getByText("Payment received").first();
    await expect(banner).toBeVisible();
    await expect(page.getByText("Credit pack", { exact: false }).first()).toBeVisible();
    // `.first()` because the same reference legitimately appears twice on this
    // page — once in this banner and once in the purchase-history list below
    // it, which is the point of quoting it in both places.
    await expect(page.getByText(`Receipt ${REFERENCE}`).first()).toBeVisible();

    // And a way out that is not the page you are already on.
    const cta = page.getByRole("link", { name: "Tailor my resume" });
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute("href", "/tailor");
  });

  test("an unknown reference stays put and says so", async ({ page }) => {
    /*
     * The failure path deliberately does NOT redirect: it has something
     * specific to say, and bouncing someone whose payment did not go through
     * onto a page of things to buy would misread the moment.
     */
    await page.goto("/login");
    await page.getByLabel("Email").fill("demo@talentrah.dev");
    await page.getByLabel("Password").fill(DEMO_PASSWORD!);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("**/jobs");

    await page.goto("/billing/callback?reference=TLR-DOES-NOT-EXIST-AT-ALL");
    await expect(page.getByText("Something didn't go through.")).toBeVisible();
    expect(page.url()).toContain("/billing/callback");
  });
});
