/**
 * send-480 — the parts of the /scholarships landing page that need real rows or a
 * real session. The signed-out, HTTP-only checks are in
 * e2e/scholarships-public-landing.spec.ts.
 *
 *  - RLS is the gate, so it is PROVEN: a verified fixture must render on the public
 *    page and a pending one must not. "Absent" is an absence, so a positive control
 *    comes first (the verified fixture is there), otherwise an empty page would pass.
 *  - The signed-in page must be exactly what it was: its old title, its filter bar,
 *    its saved-scholarship tab, and none of the landing page's content. Branching one
 *    shared route on auth state is the regression risk this whole change carries.
 *  - The signed-out checks use a genuinely SEPARATE browser context: `authedPage`
 *    adds the session cookie to the same underlying context a test receives when it
 *    destructures both fixtures, so `page` after `authedPage` is still signed in
 *    (caught live in send-385's spec).
 */
import { randomUUID } from "node:crypto";
import { test, expect, admin } from "./fixtures/authed";

function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

async function insertFixture(tag: string, over: Record<string, unknown>) {
  const { data, error } = await admin
    .from("scholarships")
    .insert({
      provider: `LANDING-TEST Provider ${tag}`,
      program_name: `LANDING-TEST ${tag}`,
      host_institution: "LANDING-TEST University",
      degree_levels: ["msc"],
      field_tags: [],
      funding_type: "full",
      funding_covers: ["tuition"],
      eligibility_nationalities: ["Nigeria"],
      official_url: "https://example.test/landing-fixture",
      dedup_fingerprint: `landing-test-${tag}`,
      ...over,
    })
    .select("id, program_name")
    .single();
  if (error || !data) throw new Error(`could not create fixture: ${error?.message}`);
  return data;
}

async function removeFixture(id: string) {
  const { error } = await admin.from("scholarships").delete().eq("id", id);
  if (error) throw new Error(`landing fixture cleanup failed: ${error.message}`);
}

test.describe("signed-out /scholarships shows real, verified listings only", () => {
  test("a verified open listing renders and a pending one does not (RLS is the gate)", async ({ browser }) => {
    const tag = randomUUID().slice(0, 8);
    // A deadline tomorrow sorts it first ("nearest deadline"), so it is within the four shown.
    const verified = await insertFixture(`V${tag}`, { moderation_status: "verified", application_deadline: isoDate(1) });
    const pending = await insertFixture(`P${tag}`, { moderation_status: "pending", application_deadline: isoDate(1) });
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const res = await page.goto("/scholarships");
      expect(res?.status()).toBe(200);
      const text = await page.locator("body").innerText();

      // Positive control first: the page really lists open scholarships.
      expect(text, "the verified fixture must be listed").toContain(verified.program_name);
      expect(text, "the pending fixture leaked onto a public page").not.toContain(pending.program_name);
      await expect(page.getByRole("link", { name: verified.program_name })).toHaveAttribute(
        "href",
        `/scholarships/${verified.id}`,
      );
      // At most four rows, and each one links out to its official page safely.
      const official = page.getByRole("link", { name: /Official listing/ });
      expect(await official.count()).toBeLessThanOrEqual(4);
      await expect(official.first()).toHaveAttribute("rel", "noopener noreferrer");
      await expect(official.first()).toHaveAttribute("target", "_blank");
    } finally {
      await context.close();
      await removeFixture(verified.id);
      await removeFixture(pending.id);
    }
  });

  test("a listing whose deadline has passed is not shown as open", async ({ browser }) => {
    const tag = randomUUID().slice(0, 8);
    const expired = await insertFixture(`X${tag}`, { moderation_status: "verified", application_deadline: isoDate(-3) });
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto("/scholarships");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await page.locator("body").innerText()).not.toContain(expired.program_name);
    } finally {
      await context.close();
      await removeFixture(expired.id);
    }
  });
});

test.describe("signed-in /scholarships is unchanged (send-480 regression check)", () => {
  test("a signed-in user still gets the catalog, its original title and none of the landing page", async ({
    authedPage,
  }) => {
    const res = await authedPage.goto("/scholarships");
    expect(res?.status()).toBe(200);
    expect(await authedPage.title()).toBe("Scholarships — Talentrah");

    await expect(authedPage.getByRole("heading", { level: 1 })).toHaveText("Scholarships");
    await expect(authedPage.getByText("Funding for your next degree")).toBeVisible();
    await expect(authedPage.getByRole("link", { name: "All scholarships" })).toBeVisible();
    await expect(authedPage.getByRole("link", { name: /Saved & tracking/ })).toBeVisible();
    await expect(authedPage.locator('form[action="/scholarships"]')).toBeVisible();

    // The real authenticated branch, not the public landing page rendered by mistake.
    await expect(authedPage.getByText("Scholarships open to applicants from Nigeria")).toHaveCount(0);
    await expect(authedPage.getByRole("link", { name: "Create a free account" })).toHaveCount(0);
    expect(await authedPage.locator("h1").count()).toBe(1);
  });

  test("a signed-in user's saved tab still works", async ({ authedPage }) => {
    const res = await authedPage.goto("/scholarships?tab=saved");
    expect(res?.status()).toBe(200);
    await expect(authedPage.getByText(/Nothing saved yet|Saved & tracking/).first()).toBeVisible();
  });
});
