import { test, expect, request as pwRequest, type Page, type Locator } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/types";

/**
 * Reporting a posting, from the card to the operator's queue.
 *
 * The vitest suite proves the table refuses the wrong writes. This proves the
 * two ends a person actually touches: the affordance on the card, and the
 * ranked list an operator reads.
 *
 * THE HIT-TARGET MEASUREMENT IS NOT DECORATION. #69 shipped a target past
 * review that read as `min-h-10` and measured 39.1px WIDE, because height and
 * width are separate and only one was named. It measures both, in a browser,
 * rather than trusting the class.
 *
 * The trigger is now an IconButton, which is 40x40 by construction rather than
 * by a hand-written pair of classes, so the specific 39.1px trap is gone. The
 * measurement stays: it is the assertion that survives someone swapping the
 * component out again, which is exactly how the original bug arrived.
 */
const SECRET = process.env.ADMIN_API_SECRET || process.env.INGEST_SECRET;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const DEMO_PASSWORD = process.env.DEMO_PASSWORD;

const admin =
  SERVICE && SUPA_URL
    ? createClient<Database>(SUPA_URL, SERVICE, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;

/*
 * A skip must not read as a pass in CI. Locally neither secret is present
 * (.env.local's INGEST_SECRET is empty and the service key is a placeholder),
 * so skipping is honest; in CI both exist, and a silent skip there would be
 * indistinguishable from a green run on the summary line.
 */
if (process.env.CI && (!SECRET || !admin || !DEMO_PASSWORD)) {
  throw new Error("report-job-posting spec cannot run in CI: missing secret, service key, or demo password");
}

/**
 * Open a card's report panel, tolerating a page that is not interactive yet.
 *
 * THE FIRST CLICK AFTER A FULL DOCUMENT LOAD GETS SWALLOWED. The jobs feed
 * renders 153 report buttons, and React attaches no onClick until the whole
 * list has hydrated — Playwright's actionability checks all pass in the
 * meantime, because the button is visible, enabled and unobstructed. It is
 * simply not wired up yet, so the click lands on nothing and is lost with no
 * error anywhere, and the test then hangs on the panel that never opened.
 *
 * That is why only the half of the test after `reload()` failed: arriving
 * from /login is a CLIENT-SIDE navigation onto an already-hydrated page,
 * while a reload starts hydration over. Instrumented on a dev server, the
 * trigger's aria-expanded stayed false through the first click and flipped on
 * the second, ~1.2s later.
 *
 * Clicking only when the panel is not already open matters — the trigger is a
 * toggle, so a blind retry would close what the previous attempt opened and
 * the loop would never converge.
 *
 * The underlying exposure is the PRODUCT'S, not the test's: a person clicking
 * Report in that window loses the click just as silently. That is generic
 * React hydration rather than a defect in this component, and it is filed
 * separately rather than worked around here.
 */
async function openReportPanel(page: Page, trigger: Locator): Promise<void> {
  await expect(async () => {
    if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
}

test.describe("reporting a posting", () => {
  test.skip(!DEMO_PASSWORD, "DEMO_PASSWORD is not set — see scripts/seed.ts");

  test.afterAll(async () => {
    if (!admin) return;
    const { error } = await admin
      .from("job_posting_reports")
      .delete()
      .ilike("details", "E2E-REPORT%");
    if (error) console.error("[report cleanup]", error.message);
  });

  test("the affordance is a real target, and reporting is idempotent per person", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("demo@talentrah.dev");
    await page.getByLabel("Password").fill(DEMO_PASSWORD!);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("**/jobs");

    const trigger = page.getByRole("button", { name: "Report" }).first();
    const box = await trigger.boundingBox();
    expect(box, "the Report trigger should be on the page").not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(40);
    expect(box!.height).toBeGreaterThanOrEqual(40);

    const panel = page.getByRole("dialog");
    await openReportPanel(page, trigger);

    // Each reason's real target is the label wrapping the 13px radio — the
    // same "the glyph is small, the target is not" shape as FilterChip's x.
    const labels = await page.evaluate(() => {
      const p = document.querySelector('[role="dialog"]')!;
      return [...p.querySelectorAll("label")]
        .filter((l) => l.querySelector('input[type="radio"]'))
        .map((l) => {
          const r = l.getBoundingClientRect();
          return { w: r.width, h: r.height };
        });
    });
    expect(labels).toHaveLength(4);
    for (const l of labels) {
      expect(l.w).toBeGreaterThanOrEqual(40);
      expect(l.h).toBeGreaterThanOrEqual(40);
    }

    // Clicking the label, not the dot, must select the radio.
    await page.getByText("The posting is discriminatory").click();
    expect(await page.locator('input[value="discriminatory"]').isChecked()).toBe(true);

    // Escape dismisses it, like the Farah menu next to it.
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();

    await openReportPanel(page, trigger);
    await page.getByText("It looks like a scam").click();
    await page.locator('textarea[name="details"]').fill("E2E-REPORT: asks for a training fee up front.");
    await page.getByRole("button", { name: "Send report" }).click();
    await expect(page.getByText("that's with our team")).toBeVisible({ timeout: 15000 });

    // Second time, same person, same posting: the unique constraint answers.
    await page.reload();
    await openReportPanel(page, page.getByRole("button", { name: "Report" }).first());
    await page.getByRole("button", { name: "Send report" }).click();
    await expect(page.getByText("already reported this one")).toBeVisible({ timeout: 15000 });
  });

  test("the operator queue ranks postings by distinct reporters", async ({ baseURL }) => {
    test.skip(!SECRET || !admin, "needs an admin secret and the service-role key");

    const api = await pwRequest.newContext({ baseURL });
    const url = "/api/admin/moderate-job-posting";

    const noAuth = await api.get(url);
    expect(noAuth.status()).toBe(401);

    const res = await api.get(url, { headers: { "x-admin-secret": SECRET! } });
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body.note).toContain("distinct reporters");
    expect(Array.isArray(body.postings)).toBe(true);
    expect(body.count).toBeGreaterThan(0);

    const reported = body.postings[0];
    expect(reported.reportCount).toBeGreaterThan(0);
    expect(Object.values(reported.reasons as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(
      reported.reportCount,
    );
    // Ranked, not arbitrary.
    const counts = body.postings.map((p: { reportCount: number }) => p.reportCount);
    expect([...counts].sort((a: number, b: number) => b - a)).toEqual(counts);

    await api.dispose();
  });

  test("a removed posting drops out of the queue", async ({ baseURL }) => {
    test.skip(!SECRET || !admin, "needs an admin secret and the service-role key");

    const api = await pwRequest.newContext({ baseURL });
    const url = "/api/admin/moderate-job-posting";
    const auth = { "x-admin-secret": SECRET! };

    const before = await (await api.get(url, { headers: auth })).json();
    const target = before.postings[0];
    expect(target, "the previous test should have left a reported posting").toBeTruthy();

    await api.post(url, {
      headers: auth,
      data: { id: target.jobPostingId, action: "remove", reason: "E2E: acting on the report." },
    });

    const after = await (await api.get(url, { headers: auth })).json();
    const ids = after.postings.map((p: { jobPostingId: string }) => p.jobPostingId);
    expect(ids).not.toContain(target.jobPostingId);

    // Restoring brings the reports back — they were never retracted. Worth
    // asserting because it is the surprising half of "removal closes the
    // complaint".
    await api.post(url, {
      headers: auth,
      data: { id: target.jobPostingId, action: "restore", reason: "E2E: putting it back." },
    });
    const restored = await (await api.get(url, { headers: auth })).json();
    expect(restored.postings.map((p: { jobPostingId: string }) => p.jobPostingId)).toContain(
      target.jobPostingId,
    );

    await api.dispose();
  });
});
