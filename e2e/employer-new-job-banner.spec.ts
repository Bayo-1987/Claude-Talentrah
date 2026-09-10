/**
 * The create form's own banner picker (send-134) — an employer can now pick
 * and crop a banner on /employer/jobs/new itself, before the posting (and
 * therefore its jobId) exists. This is what proves the whole handoff really
 * works end to end: stage on the create form → publish → the post-success
 * card uploads the staged image against the real jobId → it lands in
 * storage and on the posting's own `banner_path` — not just that a fetch
 * call fires, per send-134's own testing requirement.
 *
 * Uses a REAL, decodable PNG (e2e/support/real-png.ts) rather than the
 * header-only fake tests/employer/banner.test.ts uses for its own unit
 * tests: BannerCropPicker's `onPick` calls `createImageBitmap` on whatever
 * is chosen, and react-easy-crop decodes the same file again to draw it, so
 * a fake that only satisfies validateBanner's header check would fail before
 * a crop dialog ever opened.
 */
import { test, expect, admin } from "./fixtures/authed";
import { runCleanups } from "../tests/support/teardown";
import { deleteOrgsCascade } from "../tests/support/delete-orgs";
import { makeRealPng } from "./support/real-png";

const BANNER_PNG = makeRealPng(1600, 400);

test.describe("create-form banner picker", () => {
  test.afterEach(async () => {
    await runCleanups([
      "employer organisations",
      async () => {
        const { data: orgs, error } = await admin
          .from("organizations")
          .select("id")
          .like("name", "E2E Banner Co%");
        if (error) throw new Error(`listing organisations: ${error.message}`);
        const orgIds = (orgs ?? []).map((o) => o.id);
        // Storage objects aren't cascaded by deleteOrgsCascade — clean up
        // whatever this file's own uploads left in the bucket before the
        // rows that named them are gone.
        for (const orgId of orgIds) {
          const { data: files } = await admin.storage.from("job-banners").list(orgId);
          if (files?.length) {
            await admin.storage.from("job-banners").remove(files.map((f) => `${orgId}/${f.name}`));
          }
        }
        await deleteOrgsCascade(admin, orgIds);
      },
    ]);
  });

  async function createVerifiedOrg(page: import("@playwright/test").Page, orgName: string) {
    await page.goto("/employer/onboarding");
    await page.getByLabel("Company name").fill(orgName);
    await page.getByRole("button", { name: "Create company" }).click();
    await expect(page).toHaveURL(/\/employer\/jobs$/);
    const { data: org } = await admin.from("organizations").select("id").eq("name", orgName).single();
    await admin.from("organizations").update({ verified: true }).eq("id", org!.id);
    return org!.id as string;
  }

  /** Picks BANNER_PNG, waits for the crop dialog, and confirms the crop. */
  async function pickAndCropBanner(page: import("@playwright/test").Page) {
    await page.locator('input#banner[type="file"]').setInputFiles({
      name: "banner.png",
      mimeType: "image/png",
      buffer: BANNER_PNG,
    });
    await expect(page.getByRole("dialog", { name: "Crop your banner" })).toBeVisible();
    // react-easy-crop fires its own onCropComplete once the image has
    // decoded and laid out, with no drag required — a 1600x400 source at
    // the 4:1 crop ratio already fills the frame at the default zoom.
    const useThisCrop = page.getByRole("button", { name: "Use this crop" });
    await expect(useThisCrop).toBeEnabled();
    await useThisCrop.click();
    await expect(page.getByRole("dialog", { name: "Crop your banner" })).toHaveCount(0);
  }

  test("a banner staged on the create form attaches to the correct newly-created job", async ({
    authedPage,
    testUser,
  }) => {
    const orgId = await createVerifiedOrg(authedPage, `E2E Banner Co ${testUser.id.slice(0, 8)}`);

    await authedPage.goto("/employer/jobs/new");
    await pickAndCropBanner(authedPage);
    // Substring, not the full sentence — the component renders a curly
    // apostrophe (&rsquo;) that isn't worth hardcoding into an assertion.
    await expect(authedPage.getByText("Cropped and ready")).toBeVisible();
    // The picker's own button relabels once something is staged, the same
    // way JobBannerUpload's does once a banner is already saved.
    await expect(authedPage.getByRole("button", { name: "Replace banner" })).toBeVisible();

    await authedPage.getByLabel("Job title").fill("E2E Banner Backend Engineer");
    await authedPage
      .getByLabel("Job description")
      .fill(
        "A role posted specifically to prove a staged create-form banner attaches to the right job after publishing.",
      );
    await authedPage.getByRole("button", { name: "Publish job" }).click();
    await expect(authedPage).toHaveURL(/\/employer\/jobs\?posted=.+$/);

    const jobId = new URL(authedPage.url()).searchParams.get("posted")!;

    // The deferred upload is a real network round trip after the redirect —
    // wait for its own confirmation text rather than assuming it landed.
    await expect(authedPage.getByText("Banner added.")).toBeVisible({ timeout: 15_000 });

    // Proof against the real database and real storage, not just the UI's
    // own claim: banner_path is exactly <org>/<job>.png, and the object it
    // names is really there.
    const { data: job } = await admin
      .from("job_postings")
      .select("banner_path, organization_id")
      .eq("id", jobId)
      .single();
    expect(job?.organization_id).toBe(orgId);
    expect(job?.banner_path).toBe(`${orgId}/${jobId}.png`);

    const { data: downloaded, error: downloadError } = await admin.storage
      .from("job-banners")
      .download(job!.banner_path!);
    expect(downloadError).toBeNull();
    expect(downloaded?.size).toBeGreaterThan(0);

    // The staging area must not still be holding this image now that it's
    // been used — a second, unrelated post in the same tab must start clean.
    const stillStaged = await authedPage.evaluate(() => sessionStorage.getItem("talentrah:pending-job-banner"));
    expect(stillStaged).toBeNull();

    // And the posting's own Edit page — the surface this whole feature used
    // to require — shows the same image, proving the two paths agree.
    await authedPage.goto(`/employer/jobs/${jobId}/edit`);
    await expect(authedPage.getByAltText("The banner currently on this posting")).toBeVisible();
  });

  test("publishing with no banner picked behaves exactly as before", async ({ authedPage, testUser }) => {
    await createVerifiedOrg(authedPage, `E2E Banner Co ${testUser.id.slice(0, 8)}`);

    await authedPage.goto("/employer/jobs/new");
    // The picker renders, but nothing is picked — confirms its mere presence
    // doesn't change the no-banner path.
    await expect(authedPage.getByRole("button", { name: "Add a banner" })).toBeVisible();

    const bannerRequests: string[] = [];
    authedPage.on("request", (req) => {
      if (req.url().includes("/api/employer/job-banner")) bannerRequests.push(req.url());
    });

    await authedPage.getByLabel("Job title").fill("E2E Banner No Banner Role");
    await authedPage
      .getByLabel("Job description")
      .fill("A role posted with no banner picked, to prove that path is completely unchanged.");
    await authedPage.getByRole("button", { name: "Publish job" }).click();
    await expect(authedPage).toHaveURL(/\/employer\/jobs\?posted=.+$/);

    // Exactly send-132's original pointer — no "Banner added.", no upload
    // attempt at all.
    await expect(
      authedPage.getByText("You can add a banner image on"),
    ).toBeVisible();
    await expect(authedPage.getByText("Banner added.")).toHaveCount(0);
    expect(bannerRequests, "no banner was staged, so no upload should ever fire").toHaveLength(0);

    const jobId = new URL(authedPage.url()).searchParams.get("posted")!;
    const { data: job } = await admin.from("job_postings").select("banner_path").eq("id", jobId).single();
    expect(job?.banner_path).toBeNull();
  });

  test("a banner staged but never submitted does not leak onto a later, unrelated post", async ({
    authedPage,
    testUser,
  }) => {
    await createVerifiedOrg(authedPage, `E2E Banner Co ${testUser.id.slice(0, 8)}`);

    // First visit: stage a banner, then abandon — never submit this form.
    await authedPage.goto("/employer/jobs/new");
    await pickAndCropBanner(authedPage);
    await expect(authedPage.getByRole("button", { name: "Replace banner" })).toBeVisible();
    await authedPage.goto("/employer/jobs");

    // Second, separate visit: a genuinely different post, no banner picked.
    await authedPage.goto("/employer/jobs/new");
    await expect(authedPage.getByRole("button", { name: "Add a banner" })).toBeVisible();

    const bannerRequests: string[] = [];
    authedPage.on("request", (req) => {
      if (req.url().includes("/api/employer/job-banner")) bannerRequests.push(req.url());
    });

    await authedPage.getByLabel("Job title").fill("E2E Banner Unrelated Role");
    await authedPage
      .getByLabel("Job description")
      .fill("A second, unrelated posting that must not inherit the abandoned banner from the first visit.");
    await authedPage.getByRole("button", { name: "Publish job" }).click();
    await expect(authedPage).toHaveURL(/\/employer\/jobs\?posted=.+$/);

    await expect(authedPage.getByText("You can add a banner image on")).toBeVisible();
    expect(bannerRequests, "the abandoned banner must not attach to this unrelated post").toHaveLength(0);

    const jobId = new URL(authedPage.url()).searchParams.get("posted")!;
    const { data: job } = await admin.from("job_postings").select("banner_path").eq("id", jobId).single();
    expect(job?.banner_path).toBeNull();
  });

  test("a failed deferred upload leaves the same Edit-page pointer, not silence", async ({
    authedPage,
    testUser,
  }) => {
    await createVerifiedOrg(authedPage, `E2E Banner Co ${testUser.id.slice(0, 8)}`);

    await authedPage.goto("/employer/jobs/new");
    await pickAndCropBanner(authedPage);

    // The staged banner is real; only the DEFERRED upload (the one
    // PostSuccessBannerNote fires after redirect) is made to fail — proves
    // the failure path degrades to the pointer rather than disappearing.
    await authedPage.route("**/api/employer/job-banner", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "boom" }) }),
    );

    await authedPage.getByLabel("Job title").fill("E2E Banner Failed Upload Role");
    await authedPage
      .getByLabel("Job description")
      .fill("A posting whose deferred banner upload is forced to fail, to prove it degrades visibly.");
    await authedPage.getByRole("button", { name: "Publish job" }).click();
    await expect(authedPage).toHaveURL(/\/employer\/jobs\?posted=.+$/);

    await expect(authedPage.getByText("You can add a banner image on")).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByText("Banner added.")).toHaveCount(0);

    const jobId = new URL(authedPage.url()).searchParams.get("posted")!;
    const { data: job } = await admin.from("job_postings").select("banner_path").eq("id", jobId).single();
    expect(job?.banner_path).toBeNull();

    // The failed attempt still consumed the staged entry — a retry on some
    // later page load must not silently re-fire against a different job.
    const stillStaged = await authedPage.evaluate(() => sessionStorage.getItem("talentrah:pending-job-banner"));
    expect(stillStaged).toBeNull();
  });
});
