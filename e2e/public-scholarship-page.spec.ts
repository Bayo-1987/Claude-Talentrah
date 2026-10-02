/**
 * The scholarship detail page is public. (The list behind it was not until send-480, which
 * made /scholarships a real signed-out landing page — see the last test.)
 *
 * ── WHY THIS PAGE EXISTS ──────────────────────────────────────────────────
 *
 * There was no detail route at all before this: every listing lived only as
 * a card on the authenticated /scholarships feed, so "fully funded
 * scholarships for Nigerians"-class search queries had nothing of
 * Talentrah's to rank. The scholarship-side equivalent of #152's
 * /jobs/[id], and following the same shape deliberately — see
 * e2e/public-job-page.spec.ts, which this file mirrors test-for-test where
 * the two surfaces genuinely match, and diverges where they don't (there is
 * no in-app "apply" for a scholarship — the official page is always where
 * that happens, and the account-gated actions are Save and Farah's
 * eligibility check instead).
 *
 * ── THE TEST THAT MATTERS MOST IS THE LAST ONE ────────────────────────────
 *
 * The layout gate in (app)/layout.tsx was already relaxed for /jobs/[id],
 * and this page relies on that SAME relaxation rather than a second one —
 * so the risk is not "does the gate exist" but "does something under (app)
 * quietly start depending on the layout for protection it does not have".
 * Re-asserted here, independently of the jobs file, because a regression
 * that broke this list without breaking the jobs one should still be caught.
 *
 * A fixed scholarship is used deliberately, matching the job test's own
 * reasoning: it is a verified listing with a real host institution and a
 * dated deadline, so the assertions test the wiring rather than whichever
 * listing happens to sort first.
 *
 * Resolved by natural key, not a hardcoded id (Stage 2) — same reasoning as
 * e2e/public-job-page.spec.ts: a literal id was only ever stable because the
 * old shared CI database was never wiped, and a fresh per-run local Supabase
 * stack generates a new one every run. program_name is the scholarship's own
 * stable identity (seed-catalog.ts upserts scholarships on dedup_fingerprint,
 * which is itself derived from provider/program_name/cycle_year).
 */
import { test, expect, type Page } from "@playwright/test";
import { admin } from "./fixtures/authed";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD;
let SCHOLARSHIP: string;

test.beforeAll(async () => {
  const { data, error } = await admin
    .from("scholarships")
    .select("id")
    .eq("program_name", "Gates Cambridge Scholarship")
    .eq("moderation_status", "verified")
    .single();
  if (error || !data) {
    throw new Error(`seeded "Gates Cambridge Scholarship" not found — run \`npm run seed:catalog\`: ${error?.message ?? "no row"}`);
  }
  SCHOLARSHIP = data.id;
});

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo@talentrah.dev");
  await page.getByLabel("Password", { exact: true }).fill(DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/jobs");
}

test("signed OUT: reads the listing, cannot act, gets exactly one BreadcrumbList and no other JSON-LD", async ({ page }) => {
  const res = await page.goto(`/scholarships/${SCHOLARSHIP}`);
  expect(res?.status(), "signed-out request must not redirect").toBe(200);
  expect(page.url()).toContain(`/scholarships/${SCHOLARSHIP}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Gates Cambridge Scholarship");
  await expect(
    page.getByRole("link", { name: "Create a free account to save this scholarship" }),
  ).toBeVisible();
  // The official-source link is not gated — it is the point of the page.
  await expect(page.getByRole("link", { name: /View the official listing/ })).toBeVisible();
  // Farah's actions and the save control are authenticated-only.
  await expect(page.getByRole("button", { name: /Check my eligibility/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save this scholarship" })).toHaveCount(0);
  await expect(page.getByTestId("farah-panel")).toHaveCount(0);
  /*
   * CHANGED DELIBERATELY (send-509, S3-21c / P10). This used to assert ZERO structured data, on the ground that Google's gallery has no
   * scholarship rich result (checked 2026-09-01; docs/scholarship-sources.md) and that nothing should be claimed that a crawler cannot
   * verify. That reasoning still holds for any scholarship-shaped type, so what is allowed now is EXACTLY ONE BreadcrumbList and nothing
   * else: a supported rich result, built from the trail already on the page. Anything else, a second block, a MonetaryGrant, a Course,
   * still fails here.
   */
  await expectOnlyBreadcrumbList(page, [
    ["Talentrah", "/"],
    ["Scholarships", "/scholarships"],
    ["Gates Cambridge Scholarship", `/scholarships/${SCHOLARSHIP}`],
  ]);
});

/**
 * The page carries exactly one ld+json block; it parses; it is a BreadcrumbList; its items are positioned 1..n, named, and ABSOLUTE urls on
 * this site, in the order the visible trail would read. The parent URLs are real pages (they answer 200).
 */
async function expectOnlyBreadcrumbList(page: import("@playwright/test").Page, trail: Array<[string, string]>) {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(blocks, "exactly one structured-data block, and it is the breadcrumb").toHaveLength(1);
  const data = JSON.parse(blocks[0]) as { "@context": string; "@type": string; itemListElement: Array<{ "@type": string; position: number; name: string; item: string }> };
  expect(data["@context"]).toBe("https://schema.org");
  expect(data["@type"]).toBe("BreadcrumbList");
  expect(data.itemListElement.map((i) => i.position)).toEqual(trail.map((_, i) => i + 1));
  expect(data.itemListElement.map((i) => i.name)).toEqual(trail.map(([name]) => name));
  const origin = new URL(page.url()).origin;
  for (const [i, [, path]] of trail.entries()) {
    const url = new URL(data.itemListElement[i].item);
    expect(url.pathname, `item ${i + 1}`).toBe(path);
    expect(data.itemListElement[i]["@type"]).toBe("ListItem");
  }
  expect(blocks[0]).not.toMatch(/MonetaryGrant|"Course"|"Article"|"Offer"/);
  // Parents are real pages, not 404s (a crawler follows them).
  for (const [, path] of trail.slice(0, -1)) {
    const res = await page.request.get(new URL(path, origin).toString());
    expect(res.status(), `${path} must answer 200`).toBe(200);
  }
}

test("a second scholarship page (apply-now) carries exactly one BreadcrumbList too", async ({ page }) => {
  const res = await page.goto("/scholarships/apply-now");
  expect(res?.status()).toBe(200);
  await expectOnlyBreadcrumbList(page, [
    ["Talentrah", "/"],
    ["Scholarships", "/scholarships"],
    ["Scholarships to apply to now", "/scholarships/apply-now"],
  ]);
});

test("the save CTA routes to signup and comes back", async ({ page }) => {
  await page.goto(`/scholarships/${SCHOLARSHIP}`);
  await page.getByRole("link", { name: "Create a free account to save this scholarship" }).click();
  await page.waitForURL("**/signup**");
  expect(decodeURIComponent(page.url())).toContain(`redirectTo=/scholarships/${SCHOLARSHIP}`);
});

test("a pending listing 404s exactly like a nonexistent one", async ({ page, request }) => {
  /*
   * The two cases — "no such id" and "not yours to see" — must not be
   * distinguishable, or the 404 itself becomes a way to enumerate real ids.
   * RLS is what makes this true (0084): the page issues the same query
   * either way and never learns which case it is in.
   */
  const pendingRes = await request.get("/scholarships/b35f9bbf-5497-4f50-969f-6437dbd473e0", {
    maxRedirects: 0,
  });
  const missingRes = await request.get("/scholarships/00000000-0000-0000-0000-000000000000", {
    maxRedirects: 0,
  });
  expect(pendingRes.status(), "a pending listing must 404, not redirect or 200").toBe(404);
  expect(missingRes.status()).toBe(404);
});

test("signed IN: the account-gated controls are back and nothing regressed", async ({ page }) => {
  test.skip(!DEMO_PASSWORD, "DEMO_PASSWORD is not set");
  await login(page);
  await page.goto(`/scholarships/${SCHOLARSHIP}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Gates Cambridge Scholarship");
  await expect(
    page.getByRole("link", { name: "Create a free account to save this scholarship" }),
  ).toHaveCount(0);
  await expect(page.getByTestId("farah-panel")).toBeVisible();
  await expect(page.getByRole("button", { name: /Check my eligibility/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Draft my personal statement/ })).toBeVisible();
  /*
   * Two legitimate signed-in states for the save control, not one: it may
   * read "Save this scholarship" or "Remove from saved scholarships"
   * depending on whether the demo account already saved this listing.
   */
  const save = page.getByRole("button", { name: "Save this scholarship" });
  const saved = page.getByRole("button", { name: "Remove from saved scholarships" });
  expect((await save.count()) + (await saved.count()), "no save affordance found").toBeGreaterThan(
    0,
  );
});

test("other app routes still require a session, and the scholarships list no longer does (send-480)", async ({
  page,
}) => {
  // The layout gate is shared; each page's own requireUser must still hold.
  for (const path of ["/refer", "/settings", "/billing"]) {
    await page.goto(path);
    expect(page.url(), `${path} did not redirect a signed-out visitor`).toContain("/login");
  }

  // send-480: the scholarships LIST is now a real signed-out landing page (see
  // e2e/scholarships-public-landing.spec.ts for its own coverage). This is the control that
  // proves the loop above can still detect a redirect — and that only this route moved.
  const res = await page.goto("/scholarships");
  expect(res?.status()).toBe(200);
  expect(page.url()).not.toContain("/login");
});
