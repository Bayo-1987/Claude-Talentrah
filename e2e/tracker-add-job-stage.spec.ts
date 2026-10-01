import { test, expect, admin } from "./fixtures/authed";

/**
 * send-494 / S14 + X2 — the Add-a-job form and the per-card stage select.
 *
 *  - The form's Stage select now lists the tracker's real stages with real labels, Hired included (it had a
 *    private lowercase list with no Hired, capitalised by CSS).
 *  - A manual entry added at Hired is backfilled history: it lands as `hired` with an applied date, and the
 *    card's stage select is named for the job it changes ("Stage for {title} at {company}") instead of being an
 *    anonymous combobox.
 *
 * What the server does with a FORGED stage value is unit-tested (tests/tracker/add-manual-entry-action.test.ts):
 * a Server Action's POST cannot be forged from a browser form that only offers valid options.
 */

const ALL_STAGES = ["Saved", "Applied", "Interviewing", "Offer", "Hired", "Rejected", "Archived"];

async function openAddForm(page: import("@playwright/test").Page) {
  await page.goto("/tracker");
  await page.getByText("+ Add a job you applied to outside Talentrah").click();
}

test.describe("the Add-a-job form", () => {
  test("offers every stage with a real label, Hired included, starting on Saved", async ({ authedPage }) => {
    await openAddForm(authedPage);
    const select = authedPage.getByLabel("Stage", { exact: true });
    await expect(select).toBeVisible();
    const labels = (await select.locator("option").allTextContents()).filter((t) => t !== "Select…");
    expect(labels).toEqual(ALL_STAGES);
    await expect(select).toHaveValue("saved");
  });

  test("a job added as Hired is stored as hired, with an applied date, and its card select is named for it", async ({
    authedPage,
    testUser,
  }) => {
    await openAddForm(authedPage);
    await authedPage.getByLabel("Company").fill("QA Hired Co");
    await authedPage.getByLabel("Job title").fill("QA Hired Role");
    await authedPage.getByLabel("Stage", { exact: true }).selectOption("hired");
    await authedPage.getByRole("button", { name: "Add to tracker" }).click();

    const cardSelect = authedPage.getByRole("combobox", { name: "Stage for QA Hired Role at QA Hired Co" });
    await expect(cardSelect).toBeVisible({ timeout: 15_000 });
    await expect(cardSelect).toHaveValue("hired");

    const { data, error } = await admin
      .from("applications")
      .select("stage, source, applied_at")
      .eq("user_id", testUser.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].stage).toBe("hired");
    expect(data![0].source).toBe("manual");
    expect(data![0].applied_at).not.toBeNull();
  });
});

test.describe("the per-card stage select", () => {
  test("each card's select is named for its own job and company", async ({ authedPage, testUser }) => {
    for (const [company, title] of [
      ["Moniepoint", "Illustrator"],
      ["Paystack", "Backend Engineer"],
    ]) {
      const { error } = await admin.from("applications").insert({
        user_id: testUser.id,
        stage: "applied",
        applied_at: new Date().toISOString(),
        manual_job_snapshot: { companyName: company, title },
      });
      if (error) throw new Error(`fixture application: ${error.message}`);
    }
    await authedPage.goto("/tracker");
    await expect(authedPage.getByRole("combobox", { name: "Stage for Illustrator at Moniepoint" })).toBeVisible();
    await expect(authedPage.getByRole("combobox", { name: "Stage for Backend Engineer at Paystack" })).toBeVisible();
    // Not one anonymous select among them.
    expect(await authedPage.locator('select[name="stage"]:not([aria-label])').count()).toBe(0);
  });
});
