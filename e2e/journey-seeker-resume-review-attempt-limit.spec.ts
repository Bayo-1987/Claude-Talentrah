/**
 * QA journey (UNRUN when written: authored on a machine with no local stack; CI is its first run): the 0238 attempt limit as a person meets it.
 *
 * Two AI resume reviews per rolling 30 days. The first two attempts are SEEDED as resolved rows, one of them a flagged one (flag_source "pattern"), because the
 * stub model's score is not controllable and a verified first review would remove the button. The part under test is what the person does: open the page, click
 * "Try again", and be told, in the page, that both reviews are used and when the next opens, with a pointer to a mentor review, and be charged nothing.
 * The DB-level behaviour itself is covered by tests/talent-directory/ai-verification-attempt-limit.test.ts; this proves the screen. Every step is screenshotted.
 */
import { test, expect, admin, grantTestCredits, requireStubbedLlm, seedBaseResume } from "./fixtures/authed";

test.use({ viewport: { width: 1280, height: 900 } });
const DAY = 86_400_000;

async function seedAttempts(userId: string, rows: Array<{ ageDays: number; flag?: "pattern" | "model" }>) {
  const inserts = rows.map((r) => {
    const at = new Date(Date.now() - r.ageDays * DAY).toISOString();
    return { user_id: userId, status: "rejected", review_type: "ai", requested_at: at, decided_at: at, ...(r.flag ? { flag_source: r.flag } : {}) };
  });
  const { error } = await admin.from("talent_verifications").insert(inserts);
  if (error) throw error;
  await admin.from("profiles").update({ talent_verification_status: "rejected" }).eq("id", userId);
}

const balance = async (userId: string) => (await admin.from("profiles").select("credits_balance").eq("id", userId).single()).data!.credits_balance;
const attempts = async (userId: string) => (await admin.from("talent_verifications").select("id", { count: "exact", head: true }).eq("user_id", userId)).count;

test("a third AI resume review in 30 days is refused on the page with the reopen date, and nothing is charged (a flagged attempt counts)", async ({ authedPage: page, testUser }, info) => {
  const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await requireStubbedLlm(page);
  await grantTestCredits(testUser.id, 200);
  await seedBaseResume(testUser.id);
  await seedAttempts(testUser.id, [{ ageDays: 3 }, { ageDays: 1, flag: "pattern" }]);
  const before = await balance(testUser.id);

  await page.goto("/talent-directory/verify");
  await shot("1-verify-page");
  await page.getByRole("button", { name: /Try again/ }).click();

  const note = page.getByText(/You.ve used both of your resume reviews by Farah \(AI\) in the past 30 days\./);
  await expect(note).toBeVisible();
  await expect(page.getByText(/The next one opens on .+\./)).toBeVisible();
  await expect(page.getByText(/ask a Talentrah mentor to review your resume/)).toBeVisible();
  await shot("2-refused-with-reopen-date");

  expect(await balance(testUser.id), "a refused attempt is not charged").toBe(before);
  expect(await attempts(testUser.id), "a refused attempt leaves no new row").toBe(2);
});

test("with only one attempt used, the same button is not refused", async ({ authedPage: page, testUser }, info) => {
  const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await requireStubbedLlm(page);
  await grantTestCredits(testUser.id, 200);
  await seedBaseResume(testUser.id);
  await seedAttempts(testUser.id, [{ ageDays: 2 }]);

  await page.goto("/talent-directory/verify");
  await page.getByRole("button", { name: /Try again/ }).click();
  // Whatever the stub grader decides, the person is not told the limit is reached.
  await page.waitForTimeout(3000);
  await shot("1-second-attempt-result");
  await expect(page.getByText(/You.ve used both of your resume reviews/)).toHaveCount(0);
});
