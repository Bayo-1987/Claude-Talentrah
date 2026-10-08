/**
 * The employer job-list widget, end to end on a built app (plan v2.1, owner-approved 7 Oct 2026): an employer switches it on in Company Profile, the framed page lists the
 * company's open jobs, and closing a job removes it from the framed page within seconds (the purge hook, not the 30-minute cache TTL).
 *
 * Also pins, in a real browser, the part a unit test cannot: the embed page really loads inside a frame on ANOTHER origin, while an ordinary app route cannot be framed.
 * What it cannot prove is the CDN purge on a real Vercel deployment (that is the CTO's preview check); on `next start` it proves Next's own cache is purged by the hook.
 *
 * Needs migration 0237 (employer_widgets, org_job_widget).
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test, expect, admin } from "./fixtures/authed";
import { runCleanups } from "../tests/support/teardown";
import { deleteOrgsCascade } from "../tests/support/delete-orgs";

test.describe("employer job-list widget", () => {
  test.afterEach(async () => {
    await runCleanups([
      "widget organisations",
      async () => {
        const { data: orgs, error } = await admin.from("organizations").select("id").like("name", "E2E Widget Co%");
        if (error) throw new Error(`listing organisations: ${error.message}`);
        await deleteOrgsCascade(admin, (orgs ?? []).map((o) => o.id));
      },
    ]);
  });

  test("switch on, list the open job, frame it from another origin, close the job and watch it leave", async ({ authedPage, testUser, browser, baseURL }) => {
    test.setTimeout(150_000);
    const orgName = `E2E Widget Co ${testUser.id.slice(0, 8)}`;
    const jobTitle = `E2E Widget Role ${testUser.id.slice(0, 8)}`;

    await authedPage.goto("/employer/onboarding");
    await authedPage.getByLabel("Company name").fill(orgName);
    await authedPage.getByRole("button", { name: "Create company" }).click();
    await expect(authedPage).toHaveURL(/\/employer\/jobs$/);

    const { data: org } = await admin.from("organizations").select("id").eq("name", orgName).single();
    const orgId = org!.id;
    // Verification is service-role-only by design (migration 0028), as in employer.spec.ts.
    await admin.from("organizations").update({ verified: true }).eq("id", orgId);

    await authedPage.goto("/employer/jobs/new");
    await authedPage.getByLabel("Job title").fill(jobTitle);
    await authedPage.getByLabel("Location").fill("Abuja, Nigeria");
    await authedPage
      .getByLabel("Job description")
      .fill("A real operations role, responsible for logistics coordination and vendor management across multiple warehouses.");
    await authedPage.getByRole("button", { name: "Publish job" }).click();
    await expect(authedPage).toHaveURL(/\/employer\/jobs\?posted=.+$/);

    // Before the switch is on: the neutral page, and the SAME page an unknown organisation gets.
    const embedPath = `/embed/jobs/${orgId}`;
    const before = await authedPage.request.get(embedPath);
    expect(before.status()).toBe(200);
    expect(await before.text()).toContain("No open jobs right now");

    // Switch it on from the Company Profile card.
    await authedPage.goto("/employer/profile");
    const card = authedPage.getByTestId("job-widget-card");
    await card.getByLabel("Show my open jobs on my website").check();
    await card.getByRole("button", { name: "Save", exact: true }).click();
    await expect(card.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
    await expect(card.getByLabel("Embed code for your website")).toHaveValue(new RegExp(`<iframe src="[^"]*${embedPath}"`));

    // The framed page now lists the job, with the framing headers and no cookie.
    const listed = await authedPage.request.get(embedPath);
    expect(listed.status()).toBe(200);
    const headers = listed.headers();
    expect(headers["x-frame-options"]).toBeUndefined();
    expect(headers["content-security-policy"]).toContain("frame-ancestors *");
    expect(headers["set-cookie"]).toBeUndefined();
    const html = await listed.text();
    expect(html).toContain(jobTitle);
    expect(html).not.toContain("<script");

    // An ordinary app route still refuses to be framed.
    const login = await authedPage.request.get("/login");
    expect(login.headers()["x-frame-options"]).toBe("DENY");

    // Framed from another origin: a tiny real server on a DIFFERENT loopback origin plays the employer's own website and embeds the widget. (It must be a real local server: a page that is
    // intercepted or about:blank has no network origin, so `frame-ancestors *` would not apply to it, and Chrome's Local Network Access check blocks a public-looking page from framing localhost.
    // In production both are public https origins.)
    const host = createServer((_req, res) => {
      res.setHeader("content-type", "text/html");
      res.end(`<!doctype html><iframe id="w" src="${baseURL}${embedPath}" title="widget" width="400" height="300"></iframe>`);
    });
    await new Promise<void>((resolve) => host.listen(0, "127.0.0.1", resolve));
    const outsider = await browser.newPage();
    try {
      await outsider.goto(`http://127.0.0.1:${(host.address() as AddressInfo).port}/careers`);
      await expect(outsider.frameLocator("#w").getByText(jobTitle)).toBeVisible({ timeout: 15_000 });
    } finally {
      await outsider.close();
      await new Promise((resolve) => host.close(resolve));
    }

    // Closing the job purges the page: it leaves the framed list within seconds, long before the cache TTL.
    await authedPage.goto("/employer/jobs");
    await authedPage.getByRole("button", { name: "Close" }).first().click();
    await expect(authedPage.getByText("Closed")).toBeVisible();
    await expect
      .poll(async () => (await (await authedPage.request.get(embedPath)).text()).includes(jobTitle), { timeout: 20_000, intervals: [500, 1000, 2000] })
      .toBe(false);
  });
});
