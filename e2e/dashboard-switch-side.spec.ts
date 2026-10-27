/**
 * DASHBOARD-SWITCH-PR1-1, end to end in the real app: /dashboard sends a MEMBER of an organisation to the side they last chose (employer when they never chose), a non-member always to /jobs, the
 * account menu's switch item sets the tr_side cookie and moves to that side, a refusal changes nothing, sign-out removes the cookie, and the /dashboard redirect is not cacheable.
 * The membership is created straight in the database (the way the other employer specs do) and removed afterwards; the company is named "E2E Employer Co ..." for the shared cleanup.
 */
import { randomUUID } from "node:crypto";
import { test, expect, admin } from "./fixtures/authed";
import type { Page } from "@playwright/test";
import { runCleanups } from "../tests/support/teardown";
import { deleteOrgsCascade } from "../tests/support/delete-orgs";
import { openMenu } from "./support/remembered-account";

test.use({ viewport: { width: 1280, height: 900 } });

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
let orgIds: string[] = [];

test.afterEach(async () => {
  await runCleanups([
    "employer organisations (dashboard switch side)",
    async () => {
      await deleteOrgsCascade(admin, orgIds);
      orgIds = [];
    },
  ]);
});

async function makeMember(userId: string) {
  const tag = randomUUID().slice(0, 8);
  const { data: org, error } = await admin.from("organizations").insert({ name: `E2E Employer Co DSW${tag}`, created_by: userId, verified: true }).select("id").single();
  if (error || !org) throw new Error(`organisation: ${error?.message}`);
  orgIds.push(org.id);
  const { error: memberError } = await admin.from("organization_members").insert({ organization_id: org.id, user_id: userId, role: "owner" });
  if (memberError) throw new Error(`membership: ${memberError.message}`);
}

// An exact path. A pattern like /\/jobs$/ also matches /employer/jobs, which is the very page these tests tell apart from /jobs.
const expectPath = (page: Page, pathname: string) => expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe(pathname);
const setSide = (page: Page, value: string) => page.context().addCookies([{ name: "tr_side", value, url: BASE }]);
// All cookies of the context, not "the cookies for this URL": the app's production build marks the cookie Secure, which a URL filter on an http address would hide.
const sideCookie = async (page: Page) => (await page.context().cookies()).find((c) => c.name === "tr_side");

test("a member with no remembered side opens the employer side (today's behaviour)", async ({ authedPage: page, testUser }) => {
  await makeMember(testUser.id);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/employer\/jobs$/);
});

test("a member whose remembered side is seeker opens /jobs, and one whose remembered side is employer opens the employer side", async ({ authedPage: page, testUser }) => {
  await makeMember(testUser.id);
  await setSide(page, "seeker");
  await page.goto("/dashboard");
  await expectPath(page, "/jobs");
  await setSide(page, "employer");
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/employer\/jobs$/);
});

test("a value that is neither side is ignored", async ({ authedPage: page, testUser }) => {
  await makeMember(testUser.id);
  for (const junk of ["Employer", "EMPLOYER", "admin", "seeker-employer", "x".repeat(200)]) {
    await setSide(page, junk);
    await page.goto("/dashboard");
    await expect(page, junk.slice(0, 20)).toHaveURL(/\/employer\/jobs$/);
  }
});

test("a forged tr_side=employer on an account that is NOT a member lands on /jobs", async ({ authedPage: page }) => {
  await setSide(page, "employer");
  await page.goto("/dashboard");
  await expectPath(page, "/jobs");
});

test("the /dashboard redirect is a 307 that no shared cache may keep", async ({ authedPage: page, testUser }) => {
  await makeMember(testUser.id);
  const res = await page.context().request.get("/dashboard", { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  const cacheControl = (res.headers()["cache-control"] ?? "").toLowerCase();
  expect(cacheControl, "Cache-Control on the /dashboard redirect").toMatch(/no-store|private/);
  expect(cacheControl).not.toMatch(/\bpublic\b|s-maxage/);
});

test("the account menu switches sides and remembers the choice, in both directions", async ({ authedPage: page, testUser }) => {
  await makeMember(testUser.id);
  await page.goto("/employer/jobs");
  await openMenu(page, "Account menu");
  await expect(page.getByRole("menuitem")).toHaveText(["Settings", "Switch to Job seeker", "Sign out"]);
  await page.getByRole("menuitem", { name: "Switch to Job seeker" }).click();
  await expectPath(page, "/jobs");
  const seeker = await sideCookie(page);
  // Secure: this job runs the production build (npm run build, npm run start), where the cookie is Secure; Chromium keeps a Secure cookie on localhost. The flag's rule is pinned in tests/auth/side-preference.test.ts.
  expect(seeker).toMatchObject({ value: "seeker", httpOnly: true, sameSite: "Lax", path: "/", secure: true });
  const days = ((seeker?.expires ?? 0) - Date.now() / 1000) / 86400;
  expect(days, "lasts about 365 days").toBeGreaterThan(364);
  expect(days).toBeLessThan(366);

  await page.goto("/dashboard");
  await expectPath(page, "/jobs");

  await openMenu(page, "Account menu");
  await expect(page.getByRole("menuitem")).toHaveText(["Settings", "Switch to Employer", "Sign out"]);
  await page.getByRole("menuitem", { name: "Switch to Employer" }).click();
  await expect(page).toHaveURL(/\/employer\/jobs$/);
  expect((await sideCookie(page))?.value).toBe("employer");
});

test("the seeker menu of an account with no organisation has no switch item", async ({ authedPage: page }) => {
  await page.goto("/jobs");
  await openMenu(page, "Account menu");
  await expect(page.getByRole("menuitem")).toHaveText(["Settings", "Sign out"]);
});

test("a non-member who forces the employer side from the menu is refused: no cookie, no move", async ({ authedPage: page }) => {
  await page.goto("/employer/onboarding");
  await openMenu(page, "Account menu");
  const item = page.getByRole("menuitem", { name: "Switch to Job seeker" });
  await expect(item).toBeVisible();
  for (const forged of ["employer", "admin", "EMPLOYER"]) {
    await page.locator('[role="menu"] input[name="side"]').evaluate((el, v) => ((el as HTMLInputElement).value = v), forged);
    await item.click();
    await page.waitForTimeout(800);
    await expect(page, forged).toHaveURL(/\/employer\/onboarding$/);
    expect(await sideCookie(page), forged).toBeUndefined();
    if (!(await page.getByRole("menu").isVisible())) await openMenu(page, "Account menu");
  }
});

test("signing out removes the remembered side", async ({ authedPage: page, testUser }) => {
  await makeMember(testUser.id);
  await setSide(page, "seeker");
  await page.goto("/jobs");
  await openMenu(page, "Account menu");
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL((u) => u.pathname === "/login");
  expect(await sideCookie(page)).toBeUndefined();
});
