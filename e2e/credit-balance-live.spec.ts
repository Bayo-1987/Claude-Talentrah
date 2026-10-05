/**
 * send-489 (issue #605) — after ANY credit-paid action, the masthead's credit balance drops by exactly the
 * charge, with no reload. #609 fixed Farah chat; this covers every other seeker spender found by the audit
 * on the issue: tailoring / cover letter, bullet rewrite, the two scholarship actions (on the DETAIL page and
 * on the LIST page), Auto-Apply confirm, and the three Talent Directory purchases.
 *
 * WHAT EACH TEST PROVES, in this order:
 *   1. the action really ran and charged EXACTLY what the price list says (CREDIT_COSTS; a positive control, so a
 *      test for an action that silently did nothing cannot pass by "the pill is unchanged");
 *   2. the masthead pill now shows EXACTLY the database balance after that charge (the price comes from
 *      CREDIT_COSTS, so a pricing change cannot make this lie);
 *   3. the page was never reloaded or navigated: a marker set on `window` before the action must survive.
 * The pill is compared to the database, not to a number computed here, so a UI that invented a number fails.
 *
 * MEASURED, not predicted (this file was run against unfixed `main` on a throwaway PR before the fix, #616):
 *   - RED on unfixed main, fixed by this PR: tailoring / cover letter (a plain `fetch` to a route handler) and
 *     bullet rewrite (a server action that never revalidates anything). Nothing re-renders the layout, so the
 *     pill kept the pre-charge number.
 *   - GREEN on unfixed main, so these tests are CONFIRMATIONS, not fixes: the two scholarship actions (on the
 *     DETAIL page and on the LIST page), Auto-Apply confirm, and the three Talent Directory purchases. Each calls
 *     `revalidatePath` after the spend, and that re-renders the layout, so the masthead follows.
 *     Next's own documentation says a Server Function "updates the UI immediately (if viewing the affected
 *     path)", and the scholarship actions revalidate `/scholarships` while the buttons also render on
 *     `/scholarships/[id]`, which suggested the detail page would stay stale. It does not: measured, it refreshes.
 *     The documented caveat is conservative for this app version.
 *
 * Runs against the stub LLM (LLM_PROVIDER=stub), like the golden path.
 */
import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect, admin, grantTestCredits, requireStubbedLlm, seedBaseResume } from "./fixtures/authed";
import { runCleanups } from "../tests/support/teardown";
import { deletePostingsCascade, deleteOrgsCascade } from "../tests/support/delete-orgs";
import { AUTO_APPLY_FREE_PER_WEEK } from "../src/lib/auto-apply/config";
import { CREDIT_COSTS } from "../src/lib/credits/costs";

const START = 200;
const JD = `We are looking for an engineer to build and operate payment APIs at scale. You will work with Node.js,
Postgres and distributed systems, and own services end to end.`;

const pill = (page: Page, n: number) => page.getByRole("link", { name: `${n} credits · Top up` });

async function startWithCredits(userId: string) {
  await grantTestCredits(userId, START);
}

async function markNoReload(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __noReload: boolean }).__noReload = true;
  });
}
async function expectNoReload(page: Page) {
  expect(
    await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload),
    "the page was reloaded or navigated, so this proves nothing about live updating",
  ).toBe(true);
}

async function dbBalance(userId: string): Promise<number> {
  const { data, error } = await admin.from("profiles").select("credits_balance").eq("id", userId).single();
  if (error || !data) throw new Error(`reading balance: ${error?.message}`);
  return data.credits_balance;
}

/** Wait for the action to have charged (the database balance fell below START), and return the new balance. */
async function waitForCharge(userId: string): Promise<number> {
  await expect.poll(() => dbBalance(userId), { message: "the action never charged", timeout: 30_000 }).toBeLessThan(START);
  return dbBalance(userId);
}

/** The three assertions above, for whichever page the action ran on. */
async function expectMastheadDropped(page: Page, userId: string, expectedCharge: number) {
  const after = await waitForCharge(userId);
  // "Exactly the charge": the price list says what this action costs, and that is what left the account.
  expect(START - after, `the charge should be exactly ${expectedCharge}`).toBe(expectedCharge);
  await expect(pill(page, after), `the masthead must show the post-charge balance (${after}), not ${START}`).toBeVisible();
  await expect(pill(page, START)).toHaveCount(0);
  await expectNoReload(page);
  return after;
}

async function readyBase(page: Page, userId: string) {
  await requireStubbedLlm(page);
  await startWithCredits(userId);
}

test.describe("tailoring and cover letter", () => {
  test("a paid run drops the masthead by exactly the charge, no reload", async ({ authedPage, testUser }) => {
    await readyBase(authedPage, testUser.id);
    await seedBaseResume(testUser.id);
    // Use up the one-time free trials so this run is paid.
    await admin.from("profiles").update({ free_trial_tailoring_used: true, free_trial_cover_letter_used: true }).eq("id", testUser.id);

    await authedPage.goto("/tailor");
    await expect(pill(authedPage, START)).toBeVisible();
    await markNoReload(authedPage);
    await authedPage.getByPlaceholder("Paste the full job description here…").fill(JD);
    await authedPage.getByRole("button", { name: "Tailor my resume" }).click();
    // A charged run asks first (send-493).
    await authedPage.getByTestId("tailor-confirm").getByRole("button", { name: "Confirm and tailor" }).click();
    await expect(authedPage.getByText("credits used", { exact: false })).toBeVisible({ timeout: 30_000 });

    await expectMastheadDropped(authedPage, testUser.id, CREDIT_COSTS.tailoringRun);
  });
});

test.describe("bullet rewrite", () => {
  test("a paid rewrite drops the masthead by exactly the charge, no reload", async ({ authedPage, testUser }) => {
    await readyBase(authedPage, testUser.id);
    await seedBaseResume(testUser.id);
    const { data: resume } = await admin.from("resumes").select("id").eq("user_id", testUser.id).eq("is_base", true).single();

    await authedPage.goto(`/resume-builder/edit?resumeId=${resume!.id}`);
    await expect(pill(authedPage, START)).toBeVisible();
    await markNoReload(authedPage);
    await authedPage.getByRole("button", { name: "More concise" }).first().click();

    await expectMastheadDropped(authedPage, testUser.id, CREDIT_COSTS.bulletRewrite);
  });
});

test.describe("scholarship actions (already refresh via revalidatePath: confirmation)", () => {
  const created: string[] = [];
  test.afterEach(async () => {
    await runCleanups([
      "scholarship fixtures",
      async () => {
        if (!created.length) return;
        const { error } = await admin.from("scholarships").delete().in("id", created.splice(0));
        if (error) throw new Error(error.message);
      },
    ]);
  });

  async function scholarshipFixture() {
    const tag = randomUUID().slice(0, 8);
    const { data, error } = await admin
      .from("scholarships")
      .insert({
        provider: `BALANCE-TEST Provider ${tag}`,
        program_name: `BALANCE-TEST Programme ${tag}`,
        host_institution: "BALANCE-TEST University",
        degree_levels: ["msc"],
        field_tags: [],
        funding_type: "full",
        funding_covers: ["tuition"],
        eligibility_nationalities: ["Nigeria"],
        official_url: "https://example.test/balance-fixture",
        dedup_fingerprint: `balance-test-${tag}`,
        moderation_status: "verified",
        application_deadline: "2099-12-31",
      })
      .select("id, program_name, provider")
      .single();
    if (error || !data) throw new Error(`scholarship fixture: ${error?.message}`);
    created.push(data.id);
    return data;
  }

  /** The "You have N credits" line FarahActions renders under the buttons must agree with the pill too. */
  const youHave = (page: Page, n: number) => page.getByText(`You have ${n} credits`);

  test("DETAIL page: an eligibility check drops the masthead AND 'You have N credits', no reload", async ({ authedPage, testUser }) => {
    await readyBase(authedPage, testUser.id);
    const s = await scholarshipFixture();
    await authedPage.goto(`/scholarships/${s.id}`);
    await expect(pill(authedPage, START)).toBeVisible();
    await expect(youHave(authedPage, START)).toBeVisible();
    await markNoReload(authedPage);
    await authedPage.getByRole("button", { name: /Check my eligibility/ }).click();
    await expect(authedPage.getByText("Likely eligible")).toBeVisible({ timeout: 30_000 });

    const after = await expectMastheadDropped(authedPage, testUser.id, CREDIT_COSTS.scholarshipEligibilityCheck);
    await expect(youHave(authedPage, after), "FarahActions' own balance line is stale").toBeVisible();
  });

  test("DETAIL page: a statement draft drops the masthead AND 'You have N credits', no reload", async ({ authedPage, testUser }) => {
    await readyBase(authedPage, testUser.id);
    const s = await scholarshipFixture();
    await authedPage.goto(`/scholarships/${s.id}`);
    await expect(pill(authedPage, START)).toBeVisible();
    await markNoReload(authedPage);
    await authedPage.getByRole("button", { name: /Draft my personal statement/ }).click();
    await authedPage.getByRole("button", { name: /^Draft it/ }).click();
    await expect(authedPage.getByText("Your draft statement")).toBeVisible({ timeout: 30_000 });

    const after = await expectMastheadDropped(authedPage, testUser.id, CREDIT_COSTS.scholarshipSopDraft);
    await expect(youHave(authedPage, after), "FarahActions' own balance line is stale").toBeVisible();
  });

  test("LIST page (the path the action revalidates): an eligibility check drops the masthead, no reload", async ({ authedPage, testUser }) => {
    await readyBase(authedPage, testUser.id);
    const s = await scholarshipFixture();
    // Isolate the fixture on the first page whatever else the catalog holds.
    await authedPage.goto(`/scholarships?q=${encodeURIComponent(s.provider)}`);
    await expect(authedPage.getByText(s.program_name).first()).toBeVisible();
    await expect(pill(authedPage, START)).toBeVisible();
    await markNoReload(authedPage);
    await authedPage.getByRole("button", { name: /Check my eligibility/ }).first().click();
    await expect(authedPage.getByText("Likely eligible")).toBeVisible({ timeout: 30_000 });

    await expectMastheadDropped(authedPage, testUser.id, CREDIT_COSTS.scholarshipEligibilityCheck);
  });
});

test.describe("Auto-Apply confirm", () => {
  const orgIds: string[] = [];
  const jobIds: string[] = [];
  test.afterEach(async () => {
    await runCleanups(
      ["auto-apply job postings", async () => { if (jobIds.length) await deletePostingsCascade(admin, jobIds.splice(0)); }],
      ["auto-apply organisations", async () => { if (orgIds.length) await deleteOrgsCascade(admin, orgIds.splice(0)); }],
    );
  });

  test("a paid confirmation (free weekly allowance used up) drops the masthead by exactly the charge, no reload", async ({ authedPage, testUser }) => {
    await readyBase(authedPage, testUser.id);
    await seedBaseResume(testUser.id);

    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .insert({ name: `Balance Co ${randomUUID().slice(0, 8)}`, created_by: testUser.id, verified: true })
      .select("id, name")
      .single();
    if (orgErr || !org) throw new Error(`org: ${orgErr?.message}`);
    orgIds.push(org.id);

    const makeJob = async (title: string) => {
      const { data, error } = await admin
        .from("job_postings")
        .insert({
          source_type: "internal",
          organization_id: org.id,
          company_name: org.name,
          title,
          description: "A fixture posting for the credit-balance e2e.",
          status: "open",
          posted_at: new Date().toISOString(),
          dedup_fingerprint: `balance-e2e-${randomUUID()}`,
        })
        .select("id, title")
        .single();
      if (error || !data) throw new Error(`job: ${error?.message}`);
      jobIds.push(data.id);
      return data;
    };

    // The free weekly allowance is AUTO_APPLY_FREE_PER_WEEK confirmed submissions in the last 7 days. Fill it
    // with submissions decided two days ago: inside the week (so they count) and outside the rolling 24-hour
    // daily cap (so the target is not blocked by that instead).
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    for (let i = 0; i < AUTO_APPLY_FREE_PER_WEEK; i++) {
      const prior = await makeJob(`Balance prior ${i} ${randomUUID().slice(0, 6)}`);
      const { error } = await admin.from("auto_apply_queue").insert({
        user_id: testUser.id,
        job_posting_id: prior.id,
        match_score: 95,
        tier: "excellent",
        source_type: "internal",
        status: "submitted",
        decided_at: twoDaysAgo,
      });
      if (error) throw new Error(`prior submission: ${error.message}`);
    }

    const target = await makeJob(`Balance target ${randomUUID().slice(0, 6)}`);
    await admin.from("match_scores").upsert(
      {
        user_id: testUser.id,
        job_posting_id: target.id,
        score: 95,
        tier: "excellent",
        explanation: {
          matchedSkills: ["sql", "python", "leadership", "stakeholder management"],
          missingSkills: ["kubernetes"],
          seniorityAlignment: "match",
        },
      },
      { onConflict: "user_id,job_posting_id" },
    );
    await admin.from("auto_apply_settings").upsert(
      { user_id: testUser.id, enabled: true, enabled_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
    await admin.from("auto_apply_queue").insert({
      user_id: testUser.id,
      job_posting_id: target.id,
      match_score: 95,
      tier: "excellent",
      source_type: "internal",
      status: "pending",
    });

    await authedPage.goto("/auto-apply");
    await expect(authedPage.getByRole("heading", { name: target.title })).toBeVisible();
    await expect(pill(authedPage, START)).toBeVisible();
    await markNoReload(authedPage);
    // send-493: with the free allowance used up, the button names its price before the click.
    await expect(
      authedPage.getByRole("button", { name: `Confirm and apply · ${CREDIT_COSTS.autoApplySubmission} credits` }),
    ).toBeVisible();
    await authedPage.getByRole("button", { name: "Confirm and apply" }).click();
    await expect(authedPage.getByRole("heading", { name: target.title })).toHaveCount(0, { timeout: 20_000 });

    // The confirmation really was charged (and not free), then the masthead must agree.
    const { data: row } = await admin.from("auto_apply_queue").select("credits_spent, status").eq("user_id", testUser.id).eq("job_posting_id", target.id).single();
    expect(row?.status).toBe("submitted");
    expect(row?.credits_spent, "this confirmation should have been charged: the free allowance was used up").toBeGreaterThan(0);
    await expectMastheadDropped(authedPage, testUser.id, CREDIT_COSTS.autoApplySubmission);
  });
});

test.describe("Talent Directory purchases", () => {
  test("AI verification drops the masthead by exactly the charge, no reload", async ({ authedPage, testUser }) => {
    await readyBase(authedPage, testUser.id);
    await seedBaseResume(testUser.id);
    await authedPage.goto("/talent-directory/verify");
    await expect(pill(authedPage, START)).toBeVisible();
    await markNoReload(authedPage);
    await authedPage.getByRole("button", { name: "Request verification" }).click();
    await expectMastheadDropped(authedPage, testUser.id, CREDIT_COSTS.talentDirectoryVerification);
  });

  test("human review drops the masthead by exactly the charge, no reload", async ({ authedPage, testUser }) => {
    await readyBase(authedPage, testUser.id);
    await seedBaseResume(testUser.id);
    await authedPage.goto("/talent-directory/verify");
    await expect(pill(authedPage, START)).toBeVisible();
    await markNoReload(authedPage);
    await authedPage.getByRole("button", { name: "Request human review" }).click();
    await expectMastheadDropped(authedPage, testUser.id, CREDIT_COSTS.talentDirectoryHumanReview);
  });

  test("a boost drops the masthead by exactly the charge, no reload", async ({ authedPage, testUser }) => {
    await readyBase(authedPage, testUser.id);
    await admin.from("profiles").update({ talent_verification_status: "verified", talent_directory_opt_in: true }).eq("id", testUser.id);
    await authedPage.goto("/talent-directory/verify");
    await expect(pill(authedPage, START)).toBeVisible();
    await markNoReload(authedPage);
    await authedPage.getByRole("button", { name: "Boost my placement" }).click();
    await expectMastheadDropped(authedPage, testUser.id, CREDIT_COSTS.talentDirectoryBoost);
  });
});
