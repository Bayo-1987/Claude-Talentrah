/**
 * send-438 originally pinned an inline HINT explaining why the Edit page's
 * assessment file-upload widget (AssessmentExerciseUpload) was missing
 * before the first save: it only renders once a `job_posting_assessments`
 * row exists.
 *
 * send-449 replaces the hint with the actual capability — the Edit page
 * now gets its OWN staging picker (EditJobAssessmentFilesPicker), the same
 * staging-then-upload-on-save pattern the Create page's
 * NewJobAssessmentFilesPicker already used, extended to cover "the posting
 * exists, the assessment doesn't yet." The hint text/prop
 * (`filesUnlockAfterSave`) no longer exists in AssessmentEditor, so this
 * file — which used to assert the hint's presence/absence — is rewritten
 * to prove the real thing it was standing in for: a file picked on Edit
 * BEFORE the first save actually lands attached to a real, newly-created
 * assessment row once that save happens, driven through the real UI
 * end to end (not just a component-prop assertion), mirroring how
 * e2e/job-posting-assessment.spec.ts's own create-time-files test proves
 * the Create-side equivalent.
 *
 * Also covers the regression this send explicitly had to protect against:
 * once an assessment already exists, the ORIGINAL upload path
 * (AssessmentExerciseUpload, added via a second trip to Edit) must still
 * work completely unaffected — EditJobAssessmentFilesPicker only ever
 * renders in the one narrow "not saved yet" window and must get out of
 * the way afterward.
 */
import { test, expect, admin } from "./fixtures/authed";
import { runCleanups } from "../tests/support/teardown";
import { deleteOrgsCascade } from "../tests/support/delete-orgs";
import type { Page } from "@playwright/test";

async function createVerifiedOrg(page: Page, orgName: string) {
  await page.goto("/employer/onboarding");
  await page.getByLabel("Company name").fill(orgName);
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page).toHaveURL(/\/employer\/jobs$/);
  const { data: org } = await admin.from("organizations").select("id").eq("name", orgName).single();
  await admin.from("organizations").update({ verified: true }).eq("id", org!.id);
  return org!.id as string;
}

async function addSkill(page: Page, skill: string) {
  await page.getByLabel("Skills seekers are matched against").fill(skill);
  await page.getByLabel("Skills seekers are matched against").press("Enter");
}

test.describe("Edit page: an assessment exercise file staged before the first save (send-449)", () => {
  let orgId: string | undefined;

  test.afterEach(async () => {
    await runCleanups([
      "assessment stage-before-save e2e organisation",
      async () => {
        if (orgId) await deleteOrgsCascade(admin, [orgId]);
      },
    ]);
  });

  test("a file picked before saving lands attached to the real, newly-created assessment row", async ({
    authedPage,
    testUser,
  }, testInfo) => {
    // Same reasoning as e2e/job-posting-assessment.spec.ts's own
    // create-time-files test: several real navigations plus two real
    // uploads add up past the default 30s test timeout even though each
    // individual wait has its own generous budget.
    testInfo.setTimeout(60_000);
    orgId = await createVerifiedOrg(authedPage, `E2E Assessment Stage Co ${testUser.id.slice(0, 8)}`);

    // A plain job with no assessment at all — job_posting_assessments has
    // no row for it yet, the exact precondition this whole flow is about.
    await authedPage.goto("/employer/jobs/new");
    await authedPage.getByLabel("Job title").fill(`E2E Assessment Stage Role ${testUser.id.slice(0, 6)}`);
    await authedPage
      .getByLabel("Job description")
      .fill("A short internal role description, at least a couple of sentences long.");
    await addSkill(authedPage, "sql");
    await authedPage.getByRole("button", { name: "Publish job" }).click();
    await expect(authedPage).toHaveURL(/\/employer\/jobs\?posted=.+$/);
    const jobId = new URL(authedPage.url()).searchParams.get("posted")!;

    // ---- Before the first save: no assessment yet, so the real upload
    //      widget (AssessmentExerciseUpload) isn't rendered — but the NEW
    //      staging picker is, and a file can be picked right here. --------
    await authedPage.goto(`/employer/jobs/${jobId}/edit`);
    await expect(authedPage.getByText("Assessment exercise files")).toHaveCount(0);
    await authedPage.getByLabel("Attach an assessment (optional)").check();
    await expect(authedPage.locator("#edit-job-assessment-files")).toBeAttached();

    const EXERCISE_CONTENT = "Write a query that returns the top 5 customers by lifetime spend.";
    await authedPage.setInputFiles("#edit-job-assessment-files", {
      name: "exercise.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(EXERCISE_CONTENT),
    });
    await expect(authedPage.getByText("exercise.txt")).toBeVisible();

    // send-448 — instructions is optional now; a title plus the staged
    // file is a complete, savable assessment on its own.
    await authedPage.locator("#assessment-title").fill("SQL take-home");
    await authedPage.getByRole("button", { name: "Save changes" }).click();

    // updateJobAction's own send-449 redirect target: a NEW assessment row
    // was just created, so the staged file has something to attach to.
    await expect(authedPage).toHaveURL(new RegExp(`/employer/jobs\\?assessmentCreated=${jobId}$`));
    await expect(authedPage.getByText("Assessment files added.")).toBeVisible({ timeout: 20_000 });

    // ---- Confirm on Edit: the file genuinely landed on the real
    //      assessment row, not just that the UI reported success. --------
    await authedPage.goto(`/employer/jobs/${jobId}/edit`);
    await expect(authedPage.getByText("Assessment exercise files")).toBeVisible();
    const exerciseLink = authedPage.getByRole("link", { name: /exercise\.txt/ });
    await expect(exerciseLink).toBeVisible();
    const href = await exerciseLink.getAttribute("href");
    expect(href).toBeTruthy();
    const response = await authedPage.request.get(href!);
    expect(response.ok()).toBe(true);
    expect(await response.text()).toBe(EXERCISE_CONTENT);

    // The staging picker's own job is done — once an assessment exists,
    // only the real widget should be present.
    await expect(authedPage.locator("#edit-job-assessment-files")).toHaveCount(0);

    // ---- REGRESSION: the ORIGINAL already-existing-assessment path
    //      (adding a second file via the real AssessmentExerciseUpload
    //      widget) still works completely unaffected by any of this.
    //      AssessmentExerciseUpload's own file input carries no id, but its
    //      "Add file" label is unique on this page (JobBannerUpload's own
    //      file input above is labelled "Choose File"). ------------------
    const SECOND_FILE_CONTENT = "task,owner,due\nDraft query,you,Friday\n";
    await authedPage.getByLabel("Add file").setInputFiles({
      name: "followup.csv",
      mimeType: "text/plain",
      buffer: Buffer.from(SECOND_FILE_CONTENT),
    });
    const followupLink = authedPage.getByRole("link", { name: /followup\.csv/ });
    await expect(followupLink).toBeVisible({ timeout: 20_000 });
    const followupHref = await followupLink.getAttribute("href");
    expect(followupHref).toBeTruthy();
    const followupResponse = await authedPage.request.get(followupHref!);
    expect(followupResponse.ok()).toBe(true);
    expect(await followupResponse.text()).toBe(SECOND_FILE_CONTENT);

    // The original file from before the first save is still there too.
    await expect(exerciseLink).toBeVisible();
  });

  test("Create page still stages its own files independently — the Edit picker never touches Create's scope", async ({
    authedPage,
    testUser,
  }) => {
    orgId = await createVerifiedOrg(authedPage, `E2E Assessment Stage Create Co ${testUser.id.slice(0, 8)}`);

    await authedPage.goto("/employer/jobs/new");
    await expect(authedPage.locator("#new-job-assessment-files")).toBeAttached();
    await authedPage.getByLabel("Attach an assessment (optional)").check();
    // The Edit-only picker's input id must never appear on Create.
    await expect(authedPage.locator("#edit-job-assessment-files")).toHaveCount(0);
  });

  /*
   * THE COLLISION THIS SEND WAS ACTUALLY ABOUT. Before send-449's scoping
   * refactor, every caller of pending-job-assessment-files.ts shared one
   * fixed IndexedDB record key — so an employer who picks a file on Create,
   * abandons that draft without publishing, then goes and attaches a
   * DIFFERENT file to an already-existing job's assessment via Edit, would
   * have had the Create-abandoned file silently attach itself too (both
   * writes landing on the same key, in the same origin's IndexedDB, real
   * browser storage — not per-tab). This drives exactly that sequence for
   * real and asserts only the Edit-staged file appears: real proof the two
   * callers' storage keys (`CREATE_SCOPE` vs. the job's own id) never
   * collide, not just that the code reads right.
   */
  test("a file abandoned on Create does not leak into a different job's Edit-staged assessment (scope isolation)", async ({
    authedPage,
    testUser,
  }, testInfo) => {
    // Same margin as the test above — this one drives two full job/
    // navigation cycles plus a real upload.
    testInfo.setTimeout(60_000);
    orgId = await createVerifiedOrg(authedPage, `E2E Assessment Scope Isolation Co ${testUser.id.slice(0, 8)}`);

    // ---- Stage a file on Create, then ABANDON the draft (navigate away
    //      without publishing) — this is the exact "stale leftover" case
    //      pending-job-assessment-files.ts's own header calls out. ---------
    await authedPage.goto("/employer/jobs/new");
    await authedPage.getByLabel("Attach an assessment (optional)").check();
    await authedPage.setInputFiles("#new-job-assessment-files", {
      name: "abandoned-create-draft.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("This was staged on Create and never published."),
    });
    await expect(authedPage.getByText("abandoned-create-draft.txt")).toBeVisible();

    // ---- Now the REAL, unrelated flow: create a plain job, then stage a
    //      DIFFERENT file for its assessment on Edit, before the first
    //      save — same as the test above, in the SAME browser context (so
    //      the same origin's IndexedDB is genuinely shared). --------------
    await authedPage.goto("/employer/jobs/new");
    await authedPage.getByLabel("Job title").fill(`E2E Scope Isolation Role ${testUser.id.slice(0, 6)}`);
    await authedPage
      .getByLabel("Job description")
      .fill("A short internal role description, at least a couple of sentences long.");
    await addSkill(authedPage, "sql");
    await authedPage.getByRole("button", { name: "Publish job" }).click();
    await expect(authedPage).toHaveURL(/\/employer\/jobs\?posted=.+$/);
    const jobId = new URL(authedPage.url()).searchParams.get("posted")!;

    await authedPage.goto(`/employer/jobs/${jobId}/edit`);
    await authedPage.getByLabel("Attach an assessment (optional)").check();
    await authedPage.setInputFiles("#edit-job-assessment-files", {
      name: "real-edit-exercise.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("This is the file actually meant for this job."),
    });
    await authedPage.locator("#assessment-title").fill("Scope isolation check");
    await authedPage.getByRole("button", { name: "Save changes" }).click();
    await expect(authedPage).toHaveURL(new RegExp(`/employer/jobs\\?assessmentCreated=${jobId}$`));
    await expect(authedPage.getByText("Assessment files added.")).toBeVisible({ timeout: 20_000 });

    // ---- ONLY the Edit-staged file attached — the Create-abandoned one
    //      never leaked in under a shared key. ----------------------------
    await authedPage.goto(`/employer/jobs/${jobId}/edit`);
    await expect(authedPage.getByRole("link", { name: /real-edit-exercise\.txt/ })).toBeVisible();
    await expect(authedPage.getByText("abandoned-create-draft.txt")).toHaveCount(0);
  });
});
