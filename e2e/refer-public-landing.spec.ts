/**
 * Refer & Earn (send-515) — /refer used to redirect every signed-out visitor to /login (a 307 from proxy.ts). It is now a real public
 * landing page (the shape /jobs and /tracker took in send-484; see e2e/jobs-tracker-public-landing.spec.ts, which this mirrors).
 *
 * SIGNED-OUT AND HTTP-ONLY on purpose: it imports nothing from ./fixtures, so it needs no database and can be pointed at any deployment
 * with E2E_BASE_URL. What it pins: a real 200, exactly one <h1> in the RAW response, no leaderboard call, the CTA, robots and the sitemap.
 */
import { test, expect } from "@playwright/test";

const PATH = "/refer";

test.describe("signed-out visitor at /refer", () => {
  test("gets a real 200, not the 307 to /login this route always used to send", async ({ request }) => {
    const res = await request.get(PATH, { maxRedirects: 0 });
    expect(res.status(), "a signed-out request to /refer must not redirect").toBe(200);
  });

  test("has exactly ONE <h1> in the RAW response (a streamed loading fallback must not add a second)", async ({ request }) => {
    const html = await (await request.get(PATH, { maxRedirects: 0 })).text();
    expect(html.match(/<h1[\s>]/g)?.length ?? 0).toBe(1);
  });

  test("has its own title and description, and the bare canonical", async ({ page }) => {
    const response = await page.goto(PATH);
    expect(response?.status()).toBe(200);
    expect(page.url()).not.toContain("/login");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page).toHaveTitle(/Refer/);
    await expect(page).not.toHaveTitle("Refer a Friend — Talentrah");
    await expect(page).not.toHaveTitle("Log in — Talentrah");
    const description = await page.locator('meta[name="description"]').first().getAttribute("content");
    expect(description!.length).toBeLessThanOrEqual(160);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/refer$/);
  });

  test("states the reward, when it pays, the limit and the self-referral rule, and offers 'Create a free account to get your link'", async ({ page }) => {
    await page.goto(PATH);
    const main = page.locator("main");
    await expect(main).toContainText(/\d+ credits/);
    await expect(main).toContainText(/Up to \d+ rewarded referrals in any \d+ days\./);
    await expect(main).toContainText("saved a resume");
    await expect(main).toContainText(/Referring yourself/);
    const cta = page.getByRole("link", { name: "Create a free account to get your link" }).first();
    await expect(cta).toHaveAttribute("href", "/signup?redirectTo=%2Frefer");
  });

  test("makes NO leaderboard call (anon cannot execute referral_leaderboard) and shows no log-in form", async ({ page }) => {
    const rpcCalls: string[] = [];
    page.on("request", (r) => {
      if (/referral_leaderboard/.test(r.url())) rpcCalls.push(r.url());
    });
    await page.goto(PATH);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(rpcCalls).toEqual([]);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  });

  test("robots.txt allows /refer and still disallows what is under it; the sitemap lists /refer", async ({ request }) => {
    const robots = await (await request.get("/robots.txt")).text();
    expect(robots).toMatch(/Disallow: \/refer\//);
    expect(robots).not.toMatch(/Disallow: \/refer\s*$/m);
    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).toMatch(/<loc>[^<]*\/refer<\/loc>/);
  });

  test("a signed-out visitor to a sub-path of /refer is still sent to log in", async ({ request }) => {
    const res = await request.get(`${PATH}/anything`, { maxRedirects: 0 });
    expect([307, 308]).toContain(res.status());
    expect(res.headers()["location"] ?? "").toMatch(/\/login/);
  });
});
