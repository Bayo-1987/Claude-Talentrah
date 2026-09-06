/**
 * Stage 7: the employer's share link, end to end.
 *
 * Two things only a browser test can actually prove:
 *
 * 1. THE LINK A VERIFIED EMPLOYER SEES REALLY WORKS FOR A STRANGER. Building
 *    the URL correctly in the component is necessary but not sufficient — the
 *    thing that matters is whether a signed-out visitor handed that exact
 *    string gets the real posting rather than a redirect or a 404. Checked
 *    against the actual /jobs/[id] public-visitor code path (a fresh,
 *    unauthenticated browser context), not just while logged in as the
 *    employer who posted it.
 *
 * 2. AN UNVERIFIED ORG NEVER EXPOSES ONE, ANYWHERE THIS SCREEN SHOWS IT. The
 *    unit tests (tests/employer/job-share-button.test.tsx) already prove the
 *    components never render the URL for "unreachable" visibility in
 *    isolation; this proves the real page never gets into a state where it
 *    would — the post-success banner right after posting, and the Jobs
 *    Posted row itself.
 */
import { test, expect, admin } from "./fixtures/authed";
import { runCleanups } from "../tests/support/teardown";
import { deleteOrgsCascade } from "../tests/support/delete-orgs";

test.describe("employer share link", () => {
  test.afterEach(async () => {
    await runCleanups([
      "employer organisations",
      async () => {
        const { data: orgs, error } = await admin
          .from("organizations")
          .select("id")
          .like("name", "E2E Share Co%");
        if (error) throw new Error(`listing organisations: ${error.message}`);
        await deleteOrgsCascade(admin, (orgs ?? []).map((o) => o.id));
      },
    ]);
  });

  test("a verified org's posted job is shareable, and the link really works signed out", async ({
    authedPage,
    testUser,
    browser,
  }) => {
    const orgName = `E2E Share Co V${testUser.id.slice(0, 8)}`;
    await authedPage.goto("/employer/onboarding");
    await authedPage.getByLabel("Company name").fill(orgName);
    await authedPage.getByRole("button", { name: "Create company" }).click();
    await expect(authedPage).toHaveURL(/\/employer\/jobs$/);

    // Verification is service-role-only by design (0028) — same as the
    // existing "verified company" test in employer.spec.ts.
    const { data: org } = await admin
      .from("organizations")
      .select("id")
      .eq("name", orgName)
      .single();
    await admin.from("organizations").update({ verified: true }).eq("id", org!.id);

    await authedPage.goto("/employer/jobs/new");
    await authedPage.getByLabel("Job title").fill("E2E Shareable Role");
    await authedPage.getByLabel("Location").fill("Lagos, Nigeria");
    await authedPage
      .getByLabel("Job description")
      .fill("A role posted specifically to prove the share link that comes out of it actually works.");
    await authedPage.getByRole("button", { name: "Publish job" }).click();

    // ---- Post-success surface -------------------------------------------
    await expect(authedPage).toHaveURL(/\/employer\/jobs\?posted=.+$/);
    await expect(authedPage.getByText('"E2E Shareable Role" is posted.')).toBeVisible();

    const { data: job } = await admin
      .from("job_postings")
      .select("id")
      .eq("organization_id", org!.id)
      .eq("title", "E2E Shareable Role")
      .single();
    const expectedPath = `/jobs/${job!.id}`;

    // The absolute URL is right there, no extra click needed.
    const successLinkText = await authedPage
      .locator("p", { hasText: expectedPath })
      .first()
      .textContent();
    expect(successLinkText).toContain(expectedPath);

    const whatsappLink = authedPage.getByRole("link", { name: "Share on WhatsApp" }).first();
    await expect(whatsappLink).toBeVisible();
    expect(await whatsappLink.getAttribute("href")).toContain(encodeURIComponent(expectedPath));

    const linkedInLink = authedPage.getByRole("link", { name: "Share on LinkedIn" }).first();
    await expect(linkedInLink).toBeVisible();
    expect(await linkedInLink.getAttribute("href")).toContain(encodeURIComponent(expectedPath));

    // ---- The row itself also offers Share, not just the success banner ---
    await authedPage.goto("/employer/jobs");
    await authedPage.getByRole("button", { name: "Share" }).first().click();
    await expect(authedPage.getByRole("link", { name: "Share on WhatsApp" })).toBeVisible();

    // ---- The link actually works for a stranger ---------------------------
    const strangerContext = await browser.newContext();
    const strangerPage = await strangerContext.newPage();
    const res = await strangerPage.goto(expectedPath);
    expect(res?.status(), "a verified org's job link must not redirect or 404 for a signed-out visitor").toBe(
      200,
    );
    await expect(strangerPage.getByRole("heading", { name: "E2E Shareable Role" })).toBeVisible();
    await strangerContext.close();
  });

  test("an unverified org's job never exposes a link anywhere on this screen", async ({
    authedPage,
    testUser,
  }) => {
    const orgName = `E2E Share Co U${testUser.id.slice(0, 8)}`;
    await authedPage.goto("/employer/onboarding");
    await authedPage.getByLabel("Company name").fill(orgName);
    /*
     * A DOMAIN THE TEST USER'S OWN EMAIL DOES NOT MATCH — deliberately, and
     * not skippable. The onboarding form (org-onboarding-form.tsx) PRE-FILLS
     * this field with the account's own confirmed work-email domain whenever
     * it isn't a consumer provider (onboarding/page.tsx's `suggestedDomain`),
     * specifically because that's the value that verifies immediately. The
     * throwaway e2e user's email is `e2e-<uuid>@<random>.talentrah.test` — a
     * real, non-consumer domain — so leaving this field untouched creates a
     * VERIFIED org on the spot, defeating the entire point of this test. The
     * first version of this test did exactly that and failed by finding a
     * fully-populated share link where none should exist; caught by the
     * test's own sabotage-proof assertions doing their job, not by a bug in
     * the feature. employer.spec.ts's existing "onboard, post a job" test
     * already established this exact pattern for the same reason.
     */
    await authedPage.getByLabel("Company website domain").fill("e2e-share-test.example");
    await authedPage.getByRole("button", { name: "Create company" }).click();
    await expect(authedPage).toHaveURL(/\/employer\/jobs$/);

    await authedPage.goto("/employer/jobs/new");
    await authedPage.getByLabel("Job title").fill("E2E Unreachable Role");
    await authedPage.getByLabel("Location").fill("Lagos, Nigeria");
    await authedPage
      .getByLabel("Job description")
      .fill("A role that must never come with a shareable link while the org is unverified.");
    await authedPage.getByRole("button", { name: "Publish job" }).click();

    // ---- Post-success surface: no link, no share targets ------------------
    await expect(authedPage).toHaveURL(/\/employer\/jobs\?posted=.+$/);
    await expect(authedPage.getByText("verify your company")).toBeVisible();
    await expect(authedPage.getByRole("link", { name: "Share on WhatsApp" })).toHaveCount(0);

    // The exact ABSOLUTE public URL, not a bare path check — a first version
    // of this checked for `/jobs/<id>` as a substring, which is exactly the
    // trap the comment above used to warn about and then walked straight
    // into: `/employer/jobs/<id>/edit` (the ordinary Edit link, always
    // present) contains `/jobs/<id>` as a literal substring too, so that
    // check false-positived on its own page's normal chrome. The share
    // components (job-share-button.tsx) only ever render the public link in
    // its full `${origin}/jobs/${id}` form — the origin prefix is exactly
    // what an internal relative link like Edit's never has, which is what
    // actually distinguishes them.
    const { data: unverifiedJob } = await admin
      .from("job_postings")
      .select("id")
      .eq("organization_id", (
        await admin.from("organizations").select("id").eq("name", orgName).single()
      ).data!.id)
      .eq("title", "E2E Unreachable Role")
      .single();
    const origin = new URL(authedPage.url()).origin;
    const bodyHtml = await authedPage.content();
    expect(bodyHtml).not.toContain(`${origin}/jobs/${unverifiedJob!.id}`);

    // ---- The row itself: "Unlock sharing", not a Share button --------------
    await authedPage.goto("/employer/jobs");
    await expect(
      authedPage.getByRole("link", { name: "Unlock sharing" }),
      "an unverified org's row must offer a way forward, not a dead share button",
    ).toBeVisible();
    await expect(authedPage.getByRole("button", { name: "Share" })).toHaveCount(0);
  });
});
