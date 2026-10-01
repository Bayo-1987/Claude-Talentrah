/**
 * send-484 — the parts of the /jobs and /tracker landing pages that need real rows or a real session.
 * The signed-out, HTTP-only checks are in e2e/jobs-tracker-public-landing.spec.ts.
 *
 *  - The preview is real rows under RLS and the freshness and unlisted rules, so it is PROVEN: fresh open
 *    fixtures render, and a closed and an unlisted one do not. "Absent" is an absence, so the positive
 *    control comes first, and the excluded fixtures are dated NEWER than every included one so that a leak
 *    would put them at the top of the list rather than hide below the fold.
 *  - The signed-in pages must be exactly what they were: old titles, feed tabs, tracker heading and filter
 *    bar, and none of the landing pages' content. Branching one shared route on auth state is the
 *    regression risk this whole change carries.
 *  - /tracker/<id>/sent keeps a real 404. A loading.tsx in an ancestor of a route that calls notFound()
 *    makes Next commit to 200 before the notFound runs (#221). tracker/loading.tsx was exactly that
 *    ancestor, and this test was RED on it (200) — see e2e/nav-responsiveness.spec.ts, which already noted
 *    the route was broken. The fix is the (list) route group, as jobs/(feed) and scholarships/(list) do.
 *  - The signed-out checks use a genuinely SEPARATE browser context: `authedPage` adds the session cookie
 *    to the same underlying context a test receives when it destructures both fixtures.
 */
import { randomUUID } from "node:crypto";
import { test, expect, admin } from "./fixtures/authed";
import { deletePostingsCascade } from "../tests/support/delete-orgs";

const MINUTE = 60_000;
const DETAIL_HREF = /^\/jobs\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function insertJob(tag: string, over: Record<string, unknown>) {
  const { data, error } = await admin
    .from("job_postings")
    .insert({
      source_type: "external",
      external_source: "landing-test",
      external_url: `https://example.test/${randomUUID()}`,
      company_name: `LANDING-TEST Co ${tag}`,
      title: `LANDING-TEST Role ${tag}`,
      description: "Fixture posting for the signed-out /jobs landing preview.",
      structured_jd: {},
      status: "open" as const,
      posted_at: new Date().toISOString(),
      dedup_fingerprint: `landing-test-${tag}-${randomUUID()}`,
      ...over,
    })
    .select("id, title")
    .single();
  if (error || !data) throw new Error(`could not create job fixture: ${error?.message}`);
  return data;
}

test.describe("signed-out /jobs shows real, listed, fresh postings only", () => {
  test("six fresh open fixtures render; a closed and an unlisted one, dated newer, do not", async ({ browser }) => {
    const tag = randomUUID().slice(0, 8);
    const now = Date.now();
    const included = [];
    // Dated in the near future so these are the newest rows in the table whatever else is seeded:
    // the preview is "newest first", and this must not depend on what else the database holds.
    for (let i = 0; i < 6; i++) {
      included.push(await insertJob(`${tag}-ok${i}`, { posted_at: new Date(now + (10 + i) * MINUTE).toISOString() }));
    }
    const closed = await insertJob(`${tag}-closed`, { status: "closed", posted_at: new Date(now + 40 * MINUTE).toISOString() });
    const unlisted = await insertJob(`${tag}-unlisted`, {
      unlisted_at: new Date().toISOString(),
      posted_at: new Date(now + 41 * MINUTE).toISOString(),
    });
    const all = [...included, closed, unlisted];
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const res = await page.goto("/jobs");
      expect(res?.status()).toBe(200);

      // AUTO-RETRYING assertions, never an innerText snapshot (see the signed-out spec's pageSettled).
      // Positive control first: the newest included fixture is listed, with a link to its detail page.
      const newest = included[included.length - 1];
      await expect(page.getByText(newest.title), "the newest included fixture must be listed").toBeVisible();
      await expect(page.getByText("Loading jobs…")).toHaveCount(0);
      await expect(page.getByRole("link", { name: newest.title })).toHaveAttribute("href", `/jobs/${newest.id}`);

      await expect(page.getByText(closed.title), "a closed posting leaked onto a public page").toHaveCount(0);
      await expect(page.getByText(unlisted.title), "an unlisted posting leaked onto a public page (0107)").toHaveCount(0);

      // At most six detail links in the preview, all pointing at real posting pages.
      const hrefs = await page.locator("main a").evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
      const detailLinks = hrefs.filter((h) => DETAIL_HREF.test(h));
      expect(detailLinks.length).toBeGreaterThan(0);
      expect(detailLinks.length).toBeLessThanOrEqual(6);

      // A plain, aggregated listing is labelled as such, and nothing shows a score.
      await expect(page.getByText("sourced externally").first()).toBeVisible();
      await expect(page.locator("main")).not.toContainText(/\d+\s?%\s*match/i);

      // A card is a real way in: clicking its title, signed out, lands on that posting's PUBLIC page
      // with a 200 — not on /login. (The link's href was asserted above; this follows it.)
      const [navigation] = await Promise.all([
        page.waitForResponse((r) => r.request().isNavigationRequest() && new URL(r.url()).pathname === `/jobs/${newest.id}`),
        page.getByRole("link", { name: newest.title }).click(),
      ]);
      expect(navigation.status(), "the job page behind a card must be a 200, not a redirect to /login").toBe(200);
      await expect(page).toHaveURL(new RegExp(`/jobs/${newest.id}$`));
      expect(page.url()).not.toContain("/login");
      await expect(page.getByText(newest.title).first()).toBeVisible();
    } finally {
      await context.close();
      await deletePostingsCascade(admin, all.map((j) => j.id));
    }
  });
});

test.describe("signed-in /jobs and /tracker are unchanged (send-484 regression check)", () => {
  test("a signed-in user still gets the feed, its original title and none of the landing page", async ({ authedPage }) => {
    const res = await authedPage.goto("/jobs");
    expect(res?.status()).toBe(200);
    await expect(authedPage).toHaveTitle("Jobs — Talentrah");
    // Feed chrome that only the authenticated branch renders.
    await expect(authedPage.getByRole("link", { name: "Recommended" })).toBeVisible();
    await expect(authedPage.getByText("Today's board")).toBeVisible();
    await expect(authedPage.getByText("Loading jobs…")).toHaveCount(0);
    // ...and none of the landing page.
    await expect(authedPage.getByRole("link", { name: "Create a free account" })).toHaveCount(0);
    await expect(authedPage.getByText("Reading every listing is free and needs no account.")).toHaveCount(0);
  });

  test("a signed-in user still gets their tracker, its original title and none of the landing page", async ({ authedPage }) => {
    const res = await authedPage.goto("/tracker");
    expect(res?.status()).toBe(200);
    await expect(authedPage.getByRole("heading", { level: 1 })).toHaveText("Job Tracker");
    await expect(authedPage).toHaveTitle("Job Tracker — Talentrah");
    await expect(authedPage.getByText("Every job, one place")).toBeVisible();
    await expect(authedPage.getByText("Loading the job tracker…")).toHaveCount(0);
    await expect(authedPage.getByRole("link", { name: "Archived", exact: true })).toBeVisible();
    await expect(authedPage.getByRole("link", { name: "Create a free account" })).toHaveCount(0);
    await expect(authedPage.locator("h1")).toHaveCount(1);
  });

  test("/tracker/<id>/sent for an application that does not exist is a real 404, not a 200 with a skeleton", async ({ authedPage }) => {
    // Control: the session is real, so a 404 below is the route's own notFound() and not a redirect.
    const ok = await authedPage.goto("/tracker");
    expect(ok?.status()).toBe(200);
    const res = await authedPage.goto(`/tracker/${randomUUID()}/sent`);
    expect(res?.status(), "a missing application must 404 for a signed-in user").toBe(404);
  });
});
