/**
 * The "Closes" field on the employer posting form.
 *
 * ── WHAT ACTUALLY NEEDS A BROWSER HERE ────────────────────────────────────
 *
 * The bounds themselves are unit-tested in tests/jobs/expiry-input.test.ts,
 * where removing either one fails a test. What that cannot show is the thing
 * the design rests on: that the `min`/`max` on the date input are a COURTESY
 * and not a control.
 *
 * So the last test here strips those attributes off the live DOM and posts a
 * date years out. If the server ever starts trusting the client, that test
 * goes green while every unit test still passes — which is exactly the gap a
 * unit test cannot cover, because it never had a client to trust.
 */
import { test, expect, admin } from "./fixtures/authed";
import { runCleanups } from "../tests/support/teardown";
import { deleteOrgsCascade } from "../tests/support/delete-orgs";

const DESCRIPTION =
  "A real role with a description long enough to clear the minimum length the posting form enforces on submission.";

test.describe("job expiry", () => {
  test.afterEach(async () => {
    // One step, but through runCleanups so a failed LIST still reports as a
    // teardown failure rather than aborting before the delete.
    await runCleanups([
      "expiry organisations",
      async () => {
        const { data: orgs, error } = await admin
          .from("organizations")
          .select("id")
          .like("name", "E2E Expiry Co%");
        if (error) throw new Error(`listing organisations: ${error.message}`);
        await deleteOrgsCascade(admin, (orgs ?? []).map((o) => o.id));
      },
    ]);
  });

  async function newPostingPage(authedPage: import("@playwright/test").Page, testUser: { id: string }) {
    await authedPage.goto("/employer/onboarding");
    await authedPage.getByLabel("Company name").fill(`E2E Expiry Co ${testUser.id.slice(0, 8)}`);
    await authedPage.getByRole("button", { name: "Create company" }).click();
    await expect(authedPage).toHaveURL(/\/employer\/jobs$/);
    await authedPage.goto("/employer/jobs/new");
  }

  const iso = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  test("offers every duration preset, shortest first, plus a custom date", async ({
    authedPage,
    testUser,
  }) => {
    await newPostingPage(authedPage, testUser);
    const options = await authedPage
      .locator("#expiresIn option")
      .evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
    // Order matters: a duration list that is not monotonic reads as unsorted.
    expect(options).toEqual(["", "1", "3", "7", "14", "30", "60", "custom"]);
  });

  test("the date input appears only on demand, and is bounded in the UI", async ({
    authedPage,
    testUser,
  }) => {
    await newPostingPage(authedPage, testUser);
    await expect(authedPage.locator("#expiresOn")).toHaveCount(0);

    await authedPage.locator("#expiresIn").selectOption("custom");
    const date = authedPage.locator("#expiresOn");
    await expect(date).toBeVisible();
    // Tomorrow at the earliest — a past date is not selectable at all.
    await expect(date).toHaveAttribute("min", iso(1));
    await expect(date).toHaveAttribute("max", iso(365));
  });

  test("a custom date is saved as the end of that day", async ({ authedPage, testUser }) => {
    await newPostingPage(authedPage, testUser);
    await authedPage.getByLabel("Job title").fill("E2E Expiry Custom Role");
    await authedPage.getByLabel("Location").fill("Lagos, Nigeria");
    await authedPage.getByLabel("Job description").fill(DESCRIPTION);
    await authedPage.locator("#expiresIn").selectOption("custom");
    const chosen = iso(21);
    await authedPage.locator("#expiresOn").fill(chosen);
    await authedPage.getByRole("button", { name: "Publish job" }).click();
    await expect(authedPage).toHaveURL(/\/employer\/jobs$/);

    const { data } = await admin
      .from("job_postings")
      .select("expires_at")
      .eq("title", "E2E Expiry Custom Role")
      .single();
    // End of the chosen day, so the posting is live for all of it.
    expect(data!.expires_at).not.toBeNull();
    expect(new Date(data!.expires_at!).toISOString()).toBe(`${chosen}T23:59:59.999Z`);
  });

  test("a preset still posts a duration and lands the right number of days out", async ({
    authedPage,
    testUser,
  }) => {
    await newPostingPage(authedPage, testUser);
    await authedPage.getByLabel("Job title").fill("E2E Expiry Preset Role");
    await authedPage.getByLabel("Location").fill("Lagos, Nigeria");
    await authedPage.getByLabel("Job description").fill(DESCRIPTION);
    await authedPage.locator("#expiresIn").selectOption("3");
    await authedPage.getByRole("button", { name: "Publish job" }).click();
    await expect(authedPage).toHaveURL(/\/employer\/jobs$/);

    const { data } = await admin
      .from("job_postings")
      .select("expires_at")
      .eq("title", "E2E Expiry Preset Role")
      .single();
    const days = (new Date(data!.expires_at!).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(2.9);
    expect(days).toBeLessThan(3.1);
  });

  test("the server refuses an out-of-range date even with the input's bounds stripped", async ({
    authedPage,
    testUser,
  }) => {
    /*
     * THE TEST THIS FILE EXISTS FOR.
     *
     * `min` and `max` keep a bad date from being selectable. They do not keep
     * one from being posted — anyone can submit this form directly. So the
     * attributes are removed from the live DOM here, which is the cheapest
     * honest imitation of a hand-made request, and a date well past the
     * 365-day bound is submitted.
     *
     * The posting must NOT be created, and the person must be told why. A
     * silent fallback to "no expiry" would be the wrong outcome even though it
     * is safe: they typed a date, and the form would look like it worked.
     */
    await newPostingPage(authedPage, testUser);
    await authedPage.getByLabel("Job title").fill("E2E Expiry Rejected Role");
    await authedPage.getByLabel("Location").fill("Lagos, Nigeria");
    await authedPage.getByLabel("Job description").fill(DESCRIPTION);
    await authedPage.locator("#expiresIn").selectOption("custom");

    await authedPage.locator("#expiresOn").evaluate((el) => {
      el.removeAttribute("min");
      el.removeAttribute("max");
    });
    await authedPage.locator("#expiresOn").fill(iso(900));
    await authedPage.getByRole("button", { name: "Publish job" }).click();

    await expect(
      authedPage.getByText(/closing date can be at most/i),
      "the server accepted a date past the bound, or failed silently",
    ).toBeVisible();
    // Still on the form, and nothing was written.
    await expect(authedPage).not.toHaveURL(/\/employer\/jobs$/);
    const { data } = await admin
      .from("job_postings")
      .select("id")
      .eq("title", "E2E Expiry Rejected Role");
    expect(data ?? [], "a posting was created despite the rejected date").toHaveLength(0);
  });
});
