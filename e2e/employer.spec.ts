/**
 * The employer surface, driven through the real UI.
 *
 * The integration suite (tests/employer/employer-flow.test.ts) proves the
 * POLICIES hold. This proves the screens on top of them actually work — that
 * onboarding creates an organisation, that the posting form writes a job, that
 * Jobs Posted shows it, and that an unverified company is told so plainly
 * rather than silently publishing nothing.
 *
 * That last one is the part worth having in a browser test: the failure mode
 * of migration 0027's gate is not an error, it is silence. An employer whose
 * jobs never appear and who is never told why would see a working product
 * doing nothing, and no server-side assertion catches that.
 *
 * Uses the shared throwaway-user fixture, so no password is typed and no test
 * depends on the seeded demo account.
 */
import { test, expect, admin } from "./fixtures/authed";
import { deleteOrgsCascade } from "../tests/support/delete-orgs";

test.describe("employer surface", () => {
  test.afterEach(async () => {
    /*
     * Was two bare deletes, and it did not work. The comment below it was
     * right that organisations do not cascade from their creator, and missed
     * the reason they survive anyway: `job_postings.organization_id` is NO
     * ACTION, so deleting the organisation is REFUSED whenever a posting
     * outlives the title pattern above — and supabase-js reports that by
     * resolving with `{ data: null, error }`, which nothing here read.
     *
     * `E2E Employer Co Vd9de0ad7` was found in the live project this way.
     * deleteOrgsCascade deletes in FK order and throws, so a failure here
     * fails the test rather than filling production.
     */
    const { data: orgs, error } = await admin
      .from("organizations")
      .select("id")
      .like("name", "E2E Employer Co%");
    if (error) throw new Error(`e2e teardown failed listing organisations: ${error.message}`);
    await deleteOrgsCascade(admin, (orgs ?? []).map((o) => o.id));
  });

  test("the employer masthead collapses its nav on a phone", async ({ authedPage, testUser }) => {
    /*
     * The seeker masthead's treatment, ported — and the breakpoint is NOT the
     * same, which is why this has its own test rather than a shared one.
     *
     * That side collapses at 760 because seven nav links need 728px. This one
     * has three and needs 379, so it only overflows below ~380 — but the link
     * text wraps to two lines all the way up to 640 ("Company Profile" at 59px
     * over two lines instead of 103px over one). 640 is where it stops being
     * cramped, so 640 is the breakpoint. Copying 760 would have hidden a nav
     * that fits perfectly well from 640 to 759.
     */
    const orgName = `E2E Employer Co ${testUser.id.slice(0, 8)}`;
    await authedPage.goto("/employer");
    await authedPage.getByLabel("Company name").fill(orgName);
    await authedPage.getByLabel("Company website domain").fill("e2e-employer.example");
    await authedPage.getByRole("button", { name: "Create company" }).click();
    await expect(authedPage).toHaveURL(/\/employer\/jobs$/);

    // ---- phone: nav behind the disclosure, nothing spilling sideways ------
    await authedPage.setViewportSize({ width: 390, height: 844 });
    await expect(authedPage.locator("nav")).toBeHidden();

    const trigger = authedPage.getByRole("button", { name: "Main menu" });
    await expect(trigger).toBeVisible();
    const box = await trigger.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(40);
    expect(box!.height).toBeGreaterThanOrEqual(40);

    const menu = authedPage.getByTestId("employer-nav-menu");
    // Retried: the trigger is server-rendered and clickable before React
    // attaches its handler. Same hydration race the settings spec hit.
    await expect(async () => {
      await trigger.click();
      await expect(menu).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });

    for (const label of ["Jobs Posted", "Company Profile", "Ad Campaigns", "Looking for work?"]) {
      await expect(menu.getByRole("menuitem", { name: label })).toBeVisible();
    }
    await authedPage.keyboard.press("Escape");
    await expect(menu).toBeHidden();

    const spills = await authedPage.evaluate(() => {
      const masthead = document.querySelector('[data-testid="employer-masthead"]') as HTMLElement;
      return masthead.getBoundingClientRect().right > document.documentElement.clientWidth + 1;
    });
    expect(spills, "the employer masthead must not overflow the viewport").toBe(false);

    // ---- and above the breakpoint it is the bar again ---------------------
    await authedPage.setViewportSize({ width: 640, height: 900 });
    await expect(authedPage.locator("nav")).toBeVisible();
    await expect(authedPage.getByRole("button", { name: "Main menu" })).toBeHidden();
  });

  test("a new employer can onboard, post a job, and is told why it isn't public", async ({
    authedPage,
    testUser,
  }) => {
    // ---- Onboarding -------------------------------------------------------
    // A brand-new user has no organisation, so /employer must land here rather
    // than on an empty listing or a redirect loop.
    await authedPage.goto("/employer");
    await expect(authedPage).toHaveURL(/\/employer\/onboarding$/);
    await expect(
      authedPage.getByRole("heading", { name: "Hire on Talentrah" }),
    ).toBeVisible();

    const orgName = `E2E Employer Co ${testUser.id.slice(0, 8)}`;
    await authedPage.getByLabel("Company name").fill(orgName);
    // Deliberately a domain the throwaway account's email is NOT at, so this
    // exercises the unverified path — which is the one a real first-time
    // employer without a matching work email actually hits.
    await authedPage.getByLabel("Company website domain").fill("e2e-employer.example");
    await authedPage.getByRole("button", { name: "Create company" }).click();

    await expect(authedPage).toHaveURL(/\/employer\/jobs$/);

    // ---- The unverified state is stated, not silent -----------------------
    await expect(
      authedPage.getByText(`${orgName} isn't verified yet.`),
      "an employer whose jobs will never appear must be told why",
    ).toBeVisible();

    // ---- Posting a job ----------------------------------------------------
    await authedPage.getByRole("link", { name: "Post a job" }).first().click();
    await expect(authedPage).toHaveURL(/\/employer\/jobs\/new$/);

    await authedPage.getByLabel("Job title").fill("E2E Employer Backend Engineer");
    await authedPage.getByLabel("Location").fill("Lagos, Nigeria");
    await authedPage.getByLabel("Work type").selectOption("remote");
    await authedPage.getByLabel("Employment type").selectOption("full_time");
    await authedPage
      .getByLabel("Job description")
      .fill(
        "We are hiring a backend engineer to work on payment APIs. You will design services, review code, and mentor other engineers.",
      );
    await authedPage.getByRole("button", { name: "Publish job" }).click();

    await expect(authedPage).toHaveURL(/\/employer\/jobs$/);
    await expect(
      authedPage.getByRole("heading", { name: "E2E Employer Backend Engineer" }),
    ).toBeVisible();
    await expect(authedPage.getByText("0 applications")).toBeVisible();
    // Per-posting reminder that this one is not reaching the feed.
    await expect(authedPage.getByText("Not public")).toBeVisible();

    // ---- What the poster themselves sees in the seeker feed ---------------
    //
    // Worth stating, because the first version of this test asserted the
    // opposite and failed: this user DOES see their own unverified posting at
    // /jobs. That is 0027 working as written, not a leak — its policy is
    //
    //     external  OR  org.verified  OR  is_org_member(organization_id)
    //
    // and the third clause is what lets an employer see their own draft. The
    // same-account check can therefore never prove the gate; it only proves
    // the member clause. Cross-user invisibility is proven properly, with two
    // separate authenticated users, in tests/employer/employer-flow.test.ts
    // ("an unverified org's posting is invisible to an unrelated user").
    //
    // Asserted here rather than skipped so the behaviour is recorded: if the
    // member clause is ever dropped, employers silently lose sight of their
    // own postings and this fails.
    await authedPage.goto("/jobs");
    await expect(
      authedPage.getByText("E2E Employer Backend Engineer").first(),
      "an org member should still see their own posting — 0027's member clause",
    ).toBeVisible();

    // ---- Editing round-trips ----------------------------------------------
    await authedPage.goto("/employer/jobs");
    await authedPage.getByRole("link", { name: "Edit" }).first().click();
    await expect(authedPage).toHaveURL(/\/employer\/jobs\/.+\/edit$/);
    await authedPage.getByLabel("Job title").fill("E2E Employer Staff Engineer");
    await authedPage.getByRole("button", { name: "Save changes" }).click();
    await expect(authedPage).toHaveURL(/\/employer\/jobs$/);
    await expect(
      authedPage.getByRole("heading", { name: "E2E Employer Staff Engineer" }),
    ).toBeVisible();

    // ---- Closing a posting -------------------------------------------------
    await authedPage.getByRole("button", { name: "Close" }).first().click();
    await expect(authedPage.getByText("Closed")).toBeVisible();
  });

  test("a verified company's posting does reach the seeker feed", async ({
    authedPage,
    testUser,
  }) => {
    // The positive control for the gate, at the UI layer. Without it, every
    // assertion above is equally satisfied by a feed that shows nothing at all.
    await authedPage.goto("/employer/onboarding");
    const orgName = `E2E Employer Co V${testUser.id.slice(0, 8)}`;
    await authedPage.getByLabel("Company name").fill(orgName);
    await authedPage.getByRole("button", { name: "Create company" }).click();
    await expect(authedPage).toHaveURL(/\/employer\/jobs$/);

    // Verification is service-role-only by design (migration 0028), so the
    // test grants it the same way the product does — there is no UI path, and
    // that is the point.
    const { data: org } = await admin
      .from("organizations")
      .select("id")
      .eq("name", orgName)
      .single();
    await admin.from("organizations").update({ verified: true }).eq("id", org!.id);

    await authedPage.goto("/employer/jobs/new");
    await authedPage.getByLabel("Job title").fill("E2E Employer Verified Role");
    await authedPage.getByLabel("Location").fill("Abuja, Nigeria");
    await authedPage
      .getByLabel("Job description")
      .fill(
        "A verified company posting a real role, with a description long enough to clear the minimum length the form enforces.",
      );
    await authedPage.getByRole("button", { name: "Publish job" }).click();
    await expect(authedPage).toHaveURL(/\/employer\/jobs$/);

    // No "not verified" warning this time.
    await expect(authedPage.getByText("isn't verified yet.")).toHaveCount(0);

    await authedPage.goto("/jobs?tab=recent");
    await expect(
      authedPage.getByText("E2E Employer Verified Role").first(),
      "a verified company's job should appear in the feed",
    ).toBeVisible();
  });
});
