/**
 * EMPLOYER-JOBS-HEADER-ALIGN-1: on Jobs Posted the header holds only the title block and "Post a job", sharing one top edge; the email preference has its own row below; the select is 48px tall; and
 * "Saved" appearing moves nothing (not the button, not the verification banner under the row). On a phone the three stack with no horizontal scroll.
 */
import type { Locator } from "@playwright/test";
import { test, expect, admin } from "./fixtures/authed";
import { randomUUID } from "node:crypto";
import { deleteOrgsCascade } from "../tests/support/delete-orgs";

const box = async (locator: Locator) => {
  const b = await locator.boundingBox();
  if (!b) throw new Error("element has no box");
  return b;
};

test.describe("Jobs Posted header alignment", () => {
  const orgIds: string[] = [];

  test.afterEach(async () => {
    if (orgIds.length) await deleteOrgsCascade(admin, orgIds.splice(0));
  });

  async function unverifiedOrg(ownerId: string) {
    const { data: org, error } = await admin
      .from("organizations")
      .insert({ name: `E2E Employer Co hdr ${randomUUID().slice(0, 8)}`, created_by: ownerId, verified: false })
      .select("id")
      .single();
    if (error || !org) throw new Error(`org: ${error?.message}`);
    orgIds.push(org.id);
    await admin.from("organization_members").insert({ organization_id: org.id, user_id: ownerId, role: "owner" });
  }

  test("1280px: the button shares the title block's top edge, the select is 48px, and the select is not in the button's row", async ({ authedPage: page, testUser }) => {
    await unverifiedOrg(testUser.id);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/employer/jobs");

    const header = page.getByTestId("jobs-posted-header");
    const button = page.getByRole("link", { name: "Post a job" }).first();
    const select = page.getByLabel("Emails about new applicants");
    const title = await box(page.getByTestId("jobs-posted-title-block"));

    expect(Math.abs((await box(button)).y - title.y)).toBeLessThanOrEqual(1);
    expect((await box(select)).height).toBe(48);
    await expect(header.getByLabel("Emails about new applicants")).toHaveCount(0); // the select is not inside the header
    const headerBox = await box(header);
    expect((await box(select)).y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height); // the row is under the header
    const banner = page.locator("p").filter({ hasText: "isn't verified yet" });
    const bannerBox = await box(banner);
    expect(bannerBox.y).toBeGreaterThan((await box(select)).y); // and above the banner
    const buttonBox = await box(button);
    expect(Math.abs(buttonBox.x + buttonBox.width - (bannerBox.x + bannerBox.width))).toBeLessThanOrEqual(1); // right edges match
  });

  test("1280px: 'Saved' appearing moves neither the button nor the verification banner", async ({ authedPage: page, testUser }) => {
    await unverifiedOrg(testUser.id);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/employer/jobs");
    const button = page.getByRole("link", { name: "Post a job" }).first();
    const banner = page.locator("p").filter({ hasText: "isn't verified yet" });
    const before = { button: await box(button), banner: await box(banner) };

    await page.getByLabel("Emails about new applicants").selectOption("digest");
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();

    expect(await box(button)).toEqual(before.button);
    expect((await box(banner)).y).toBe(before.banner.y);
  });

  test("1280px: a failed save shows its message in the reserved slot, announces it once, and moves nothing", async ({ authedPage: page, testUser }) => {
    await unverifiedOrg(testUser.id);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/employer/jobs");
    const button = page.getByRole("link", { name: "Post a job" }).first();
    const select = page.getByLabel("Emails about new applicants");
    const banner = page.locator("p").filter({ hasText: "isn't verified yet" });
    const before = { button: await box(button), select: await box(select), banner: await box(banner) };

    // With no email_preferences row the save finds nothing to update, which the action reports as a failed save.
    await admin.from("email_preferences").delete().eq("user_id", testUser.id);
    await select.selectOption("digest");

    const alert = page.getByRole("alert").filter({ hasText: "Couldn't save. Try again." });
    await expect(alert).toBeVisible();
    // Scoped to the setting's own row: Next renders a permanent empty <div role="alert" id="__next-route-announcer__"> on every page (see e2e/admin-login-password-toggle.spec.ts), so a page-wide count is always 2.
    await expect(page.getByTestId("new-applicant-notice-row").getByRole("alert")).toHaveCount(1);
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toHaveCount(0);
    // Announced once: the alert is not inside any aria-live region (the polite status region is its sibling, and stays empty).
    await expect(alert.locator("xpath=ancestor::*[@aria-live]")).toHaveCount(0);
    expect(await page.getByRole("status").filter({ has: alert }).count()).toBe(0);
    // The message sits in the status slot that was already reserved, so nothing moves.
    expect(await box(button)).toEqual(before.button);
    expect(await box(select)).toEqual(before.select);
    expect((await box(banner)).y).toBe(before.banner.y);
  });

  test("390px: no horizontal scroll, and the select and the button are fully visible", async ({ authedPage: page, testUser }) => {
    await unverifiedOrg(testUser.id);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/employer/jobs");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const target of [page.getByRole("link", { name: "Post a job" }).first(), page.getByLabel("Emails about new applicants")]) {
      const b = await box(target);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(390);
    }
    // stacked: title, then the button, then the preference row
    const title = await box(page.getByTestId("jobs-posted-title-block"));
    const button = await box(page.getByRole("link", { name: "Post a job" }).first());
    const row = await box(page.getByTestId("new-applicant-notice-row"));
    expect(button.y).toBeGreaterThanOrEqual(title.y + title.height);
    expect(row.y).toBeGreaterThanOrEqual(button.y + button.height);
  });
});
