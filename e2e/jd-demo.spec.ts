import { test, expect, request as pwRequest } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * The pre-signup demo, from the landing page (§6.1).
 *
 * One state per test, because the states are the feature: a visitor who has
 * used their run, a visitor whose run failed, and a signed-in visitor are
 * three different people being told three different things, and getting any of
 * them wrong is worse than the box not working at all. Running it is also how
 * the worst bug in this change was found — an internal failure was answered
 * 429, and the client rendered 429 as "you've already used the free preview"
 * to someone who had never been there.
 */
const DEMO_PASSWORD = process.env.DEMO_PASSWORD;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

if (process.env.CI && (!DEMO_PASSWORD || !SERVICE)) {
  // A skip must not read as a pass on the summary line.
  throw new Error("jd-demo spec cannot run in CI: missing DEMO_PASSWORD or service-role key");
}

const admin =
  SERVICE && SUPA_URL
    ? createClient(SUPA_URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })
    : null;

const JD = `Senior Product Manager, Payments — Lagos, Nigeria.
We are looking for a product manager with at least four years shipping payments or fintech
products in emerging markets. You will own the merchant dashboard roadmap, run discovery with
SMB merchants, and drive stakeholder alignment across compliance, operations and engineering.
Strong SQL and data analysis skills are required, along with agile delivery and roadmapping.`;

/**
 * Clear the day's ceiling before each test.
 *
 * Not optional hygiene: the cap is FIVE runs a day across all visitors, and
 * this suite alone would exhaust it on the second CI run of the afternoon —
 * turning a correct limit into a flaky test. Resetting is the same shape as
 * every other suite deleting its own fixtures.
 */
async function resetDay() {
  if (!admin) return;
  await admin.from("anonymous_demo_daily").delete().eq("day", new Date().toISOString().slice(0, 10));
}

test.use({ viewport: { width: 1280, height: 1000 } });

test.describe("the anonymous demo", () => {
  test.skip(!admin, "needs the service-role key to reset the daily ceiling");

  test.beforeEach(async () => {
    await resetDay();
  });

  test("refuses a pasted link and a too-short paste, without spending a run", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/one free run/)).toBeVisible();

    await page.getByLabel("Job description").fill("https://example.com/jobs/123");
    await page.getByRole("button", { name: "Send to Farah" }).click();
    await expect(page.getByText(/can't open a link/)).toBeVisible();

    await page.getByLabel("Job description").fill("too short");
    await page.getByRole("button", { name: "Send to Farah" }).click();
    await expect(page.getByText(/looked too short/)).toBeVisible();

    // Neither reached the limiter, so the day's budget is untouched.
    const { data } = await admin!
      .from("anonymous_demo_daily")
      .select("runs")
      .eq("day", new Date().toISOString().slice(0, 10))
      .maybeSingle();
    expect(data?.runs ?? 0).toBe(0);
  });

  test("runs once, shows the result, and refuses the second attempt", async ({ page }) => {
    /*
     * The global test timeout is 30s (playwright.config.ts), and the
     * assertion below asks for 90s. Without this line the 90s is unreachable:
     * Playwright kills the test at 30s regardless of what an individual
     * expect() is willing to wait for, so the tolerance the assertion was
     * written to provide never applied and the failure read as "the element
     * never appeared" rather than "the model call was slow".
     *
     * 120s, not 90s: the budget has to exceed the longest thing inside it, or
     * the test still dies before its own assertion gives up and the report
     * still blames the wrong thing.
     */
    test.setTimeout(120_000);

    await page.goto("/");

    // The static worked example is what's on screen until there is a real one.
    await expect(page.getByText("this is a live example")).toBeVisible();

    await page.getByLabel("Job description").fill(JD);
    await page.getByRole("button", { name: "Send to Farah" }).click();

    // Loading: CLAUDE.md §8 requires it past ~2s, and this is a model call.
    await expect(page.getByText("Farah is reading")).toBeVisible();
    await expect(page.getByLabel("Job description")).toBeDisabled();

    await expect(page.getByText("What Farah sent back")).toBeVisible({ timeout: 90000 });
    // The framing is the honest half of the demo: this is not their resume.
    await expect(page.getByText("Scored against a sample resume")).toBeVisible();
    await expect(page.getByText("this is a live example")).toHaveCount(0);

    // Second attempt, same browser context — the cookie carries the limit.
    await page.reload();
    await page.getByLabel("Job description").fill(JD);
    await page.getByRole("button", { name: "Send to Farah" }).click();
    await expect(page.getByText(/already used the free preview/)).toBeVisible({ timeout: 60000 });
    await expect(page.getByRole("link", { name: /Create a free account/ })).toBeVisible();
  });

  test("the response never carries a cover letter", async ({ baseURL }) => {
    /*
     * Asserted on the wire, not on the argument. `tailorResumeToJob` takes an
     * includeCoverLetter flag and the route passes false — a test that only
     * checked the flag would keep passing if the route ever spread the whole
     * result object, which contains a `coverLetter` field. §6.9 makes the
     * first cover letter a benefit of having an ACCOUNT; giving one away here
     * spends it, and costs a second model call nobody asked for.
     */
    const api = await pwRequest.newContext({ baseURL });
    const res = await api.post("/api/public/jd-demo", { data: { jdText: JD } });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(Object.keys(body)).not.toContain("coverLetter");
    expect(JSON.stringify(body).toLowerCase()).not.toContain('"coverletter"');
    expect(body.scoredAgainst).toBe("sample");
    expect(body.tailoredResume).toBeTruthy();

    await api.dispose();
  });

  test("the day's ceiling refuses a fresh visitor once it is spent", async ({ baseURL }) => {
    // Five distinct visitors (each context is its own cookie jar) exhaust it,
    // and the sixth gets the cap message rather than the already-used one —
    // they are different situations and say so.
    for (let i = 0; i < 5; i++) {
      const ctx = await pwRequest.newContext({ baseURL });
      await ctx.post("/api/public/jd-demo", { data: { jdText: JD } });
      await ctx.dispose();
    }

    const sixth = await pwRequest.newContext({ baseURL });
    const res = await sixth.post("/api/public/jd-demo", { data: { jdText: JD } });
    expect(res.status()).toBe(429);
    const body = await res.json();
    expect(body.reason).toBe("daily_cap");
    expect(body.error).toContain("capped at 5");
    await sixth.dispose();
  });
});

test.describe("a signed-in visitor on the landing page", () => {
  test.skip(!DEMO_PASSWORD, "DEMO_PASSWORD is not set — see scripts/seed.ts");

  /*
   * TOP UP THE DEMO ACCOUNT BEFORE EACH RUN, because these two tests SPEND.
   *
   * A signed-in tailoring run costs the one free trial and then credits. The
   * demo account is shared and long-lived, nothing replenished it, and it ran
   * out: free_trial_tailoring_used true, credits_balance 0, nine tailored
   * resumes, the last of them at 10:57 — which is the last time these tests
   * passed. Every run afterwards had the tailoring refused, so the result
   * never rendered and the assertion failed with "element(s) not found".
   *
   * That looked exactly like a slow model call and was not one. It is a test
   * that consumes a finite resource and never restores it, so it works until
   * the budget is gone and then fails permanently — the failure arrives long
   * after the change that caused it, on whatever PR happens to be next.
   *
   * Granting per test rather than once per file: the two tests below each
   * spend, and a single top-up would leave the second one one short.
   */
  test.beforeEach(async () => {
    if (!admin) return;
    const { data, error } = await admin
      .from("profiles")
      .select("id")
      .eq("email", "demo@talentrah.dev")
      .single();
    if (error || !data) throw new Error(`demo profile not found: ${error?.message}`);

    /*
     * Written straight to the ledger, which is the only way the balance moves:
     * a trigger sets profiles.credits_balance from balance_after, so updating
     * the profile column directly would be overwritten by the next ledger row.
     * Same shape as grantTestCredits in fixtures/authed.ts — not imported,
     * because that module builds a second service-role client at import time
     * and this file already has one.
     */
    const { error: grantError } = await admin.from("credit_ledger").insert({
      user_id: data.id,
      delta: 25,
      reason: "admin_adjustment",
      balance_after: 25,
    });
    if (grantError) throw new Error(`could not top up the demo account: ${grantError.message}`);
  });

  test("is tailored against their own resume, not the sample", async ({ page }) => {
    /*
     * The global test timeout is 30s (playwright.config.ts), and the
     * assertion below asks for 90s. Without this line the 90s is unreachable:
     * Playwright kills the test at 30s regardless of what an individual
     * expect() is willing to wait for, so the tolerance the assertion was
     * written to provide never applied and the failure read as "the element
     * never appeared" rather than "the model call was slow".
     *
     * 120s, not 90s: the budget has to exceed the longest thing inside it, or
     * the test still dies before its own assertion gives up and the report
     * still blames the wrong thing.
     */
    test.setTimeout(120_000);

    await page.goto("/login");
    await page.getByLabel("Email").fill("demo@talentrah.dev");
    await page.getByLabel("Password").fill(DEMO_PASSWORD!);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("**/jobs");

    // Back to the marketing page while signed in — which had no auth awareness
    // at all before this change, so this visitor got a stranger's demo.
    await page.goto("/");
    await expect(page.getByText("Tailored against your saved resume")).toBeVisible();

    await page.getByLabel("Job description").fill(JD);
    await page.getByRole("button", { name: "Send to Farah" }).click();

    await expect(page.getByText("What Farah sent back")).toBeVisible({ timeout: 90000 });
    // The sample framing would be actively wrong here.
    await expect(page.getByText("Scored against your saved resume")).toBeVisible();
    await expect(page.getByText("Scored against a sample resume")).toHaveCount(0);
    // …and no create-an-account CTA aimed at someone who has one.
    await expect(page.getByRole("link", { name: /Create a free account/ })).toHaveCount(0);
  });

  test("does not consume an anonymous run", async ({ page }) => {
    /*
     * The global test timeout is 30s (playwright.config.ts), and the
     * assertion below asks for 90s. Without this line the 90s is unreachable:
     * Playwright kills the test at 30s regardless of what an individual
     * expect() is willing to wait for, so the tolerance the assertion was
     * written to provide never applied and the failure read as "the element
     * never appeared" rather than "the model call was slow".
     *
     * 120s, not 90s: the budget has to exceed the longest thing inside it, or
     * the test still dies before its own assertion gives up and the report
     * still blames the wrong thing.
     */
    test.setTimeout(120_000);

    await resetDay();
    await page.goto("/login");
    await page.getByLabel("Email").fill("demo@talentrah.dev");
    await page.getByLabel("Password").fill(DEMO_PASSWORD!);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("**/jobs");

    await page.goto("/");
    await page.getByLabel("Job description").fill(JD);
    await page.getByRole("button", { name: "Send to Farah" }).click();
    await expect(page.getByText("What Farah sent back")).toBeVisible({ timeout: 90000 });

    // The signed-in path goes to /api/tailoring and never touches the
    // anonymous limiter — its own hourly bucket already covers it.
    const { data } = await admin!
      .from("anonymous_demo_daily")
      .select("runs")
      .eq("day", new Date().toISOString().slice(0, 10))
      .maybeSingle();
    expect(data?.runs ?? 0).toBe(0);
  });
});
