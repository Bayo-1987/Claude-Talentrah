/**
 * send-438 — the founder saw "Attach an assessment" checked, a title
 * typed in, and no file-upload control anywhere on the Edit page, with
 * nothing on the page explaining why. Traced directly: the file-upload
 * card (AssessmentExerciseUpload) only renders once a
 * `job_posting_assessments` row exists, which only happens after the
 * first save — a real, correct-by-design gap with no visible explanation.
 *
 * This pins the fix: AssessmentEditor now shows an inline hint in exactly
 * that window (checkbox on, nothing saved yet), and ONLY on the Edit page
 * — the Create page (`/employer/jobs/new`) already lets files be staged
 * before the job exists via NewJobAssessmentFilesPicker, so the same hint
 * there would be actively wrong, not just unnecessary. Driven through a
 * real save + page reload rather than asserted against component props
 * directly, since that reload is the actual mechanism the founder's
 * report is about.
 */
import { test, expect, admin } from "./fixtures/authed";
import { runCleanups } from "../tests/support/teardown";
import { deleteOrgsCascade } from "../tests/support/delete-orgs";
import type { Page } from "@playwright/test";

const HINT_TEXT = "Save this job to unlock attaching an exercise file here";

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

test.describe("the assessment file-upload hint only appears where the upload is actually hidden", () => {
  let orgId: string | undefined;

  test.afterEach(async () => {
    await runCleanups([
      "assessment-hint e2e organisation",
      async () => {
        if (orgId) await deleteOrgsCascade(admin, [orgId]);
      },
    ]);
  });

  test("Edit page: visible before the first save, gone (with the real upload card) after it", async ({
    authedPage,
    testUser,
  }) => {
    orgId = await createVerifiedOrg(authedPage, `E2E Assessment Hint Co ${testUser.id.slice(0, 8)}`);

    // A plain job with no assessment at all — never touches the "Attach an
    // assessment" checkbox on create, so job_posting_assessments has no row.
    await authedPage.goto("/employer/jobs/new");
    await authedPage.getByLabel("Job title").fill(`E2E Assessment Hint Role ${testUser.id.slice(0, 6)}`);
    await authedPage
      .getByLabel("Job description")
      .fill("A short internal role description, at least a couple of sentences long.");
    await addSkill(authedPage, "sql");
    await authedPage.getByRole("button", { name: "Publish job" }).click();
    await expect(authedPage).toHaveURL(/\/employer\/jobs\?posted=.+$/);
    const jobId = new URL(authedPage.url()).searchParams.get("posted")!;

    // ---- Before the first save with the box checked: hint visible, no upload card.
    await authedPage.goto(`/employer/jobs/${jobId}/edit`);
    await expect(authedPage.getByText("Assessment exercise files")).toHaveCount(0);
    await authedPage.getByLabel("Attach an assessment (optional)").check();
    await expect(authedPage.getByText(HINT_TEXT)).toBeVisible();
    await expect(authedPage.getByText("Assessment exercise files")).toHaveCount(0);

    // ---- Save once with the box on: updateJobAction redirects to
    //      /employer/jobs (not back to this same edit page) — the founder's
    //      own "the page reloads" describes re-opening Edit afterwards, not
    //      an in-place refresh, so the test follows that same real path
    //      rather than asserting something the redirect doesn't do.
    //      Instructions is required (parseJobPostingAssessmentForm) — title
    //      alone leaves the save silently stuck on this same page with an
    //      error, which is a real footgun a real employer could also hit
    //      (its own separate issue, not this send's scope).
    await authedPage.locator("#assessment-title").fill("Take-home exercise");
    await authedPage.locator("#assessment-instructions").click();
    await authedPage.keyboard.type("Complete the attached exercise and reply within 48 hours.");
    await authedPage.getByRole("button", { name: "Save changes" }).click();
    await expect(authedPage).toHaveURL(/\/employer\/jobs$/);

    // ---- Re-opening Edit: hint gone, real upload card in its place.
    await authedPage.goto(`/employer/jobs/${jobId}/edit`);
    await expect(authedPage.getByText("Assessment exercise files")).toBeVisible();
    await expect(authedPage.getByText(HINT_TEXT)).toHaveCount(0);
    await expect(authedPage.getByLabel("Attach an assessment (optional)")).toBeChecked();
  });

  test("Create page: never shows the Edit-only hint, staging picker still works", async ({
    authedPage,
    testUser,
  }) => {
    orgId = await createVerifiedOrg(authedPage, `E2E Assessment Hint Create Co ${testUser.id.slice(0, 8)}`);

    await authedPage.goto("/employer/jobs/new");
    await expect(authedPage.locator("#new-job-assessment-files")).toBeAttached();
    await authedPage.getByLabel("Attach an assessment (optional)").check();
    await expect(authedPage.getByText(HINT_TEXT)).toHaveCount(0);
  });
});
