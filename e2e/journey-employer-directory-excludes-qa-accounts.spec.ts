/**
 * QA journey (UNRUN when written; EXPECTED RED until 0240 / QA-EXCL lands on the CI stack): QA test accounts must not appear in the employer's Talent Directory.
 *
 * Owner rule (QA-EXCL): an account whose email contains "+qa-", or whose display name starts with "QA", is excluded from public listings, counts and the
 * directory. Fixture, all on the CI database as the service role, on throwaway users: an employer with a verified organisation and an ACTIVE directory
 * subscription (the same set-up as e2e/resume-reviewed-badge.spec.ts, minus the job posting), and three directory candidates who have each passed a review and
 * opted in: an ordinary one, one with a "+qa-" email, and one whose first name is "QA". The employer opens the directory through the page and must see the
 * ordinary candidate and neither of the others. The ordinary candidate's presence is asserted FIRST so a red result means "the QA accounts are listed", not "the
 * list did not render". Every step is screenshotted.
 */
import { randomUUID } from "node:crypto";
import { test, expect, admin } from "./fixtures/authed";
import { runCleanups } from "../tests/support/teardown";
import { deleteOrgsCascade } from "../tests/support/delete-orgs";

test.use({ viewport: { width: 1280, height: 900 } });

const tag = randomUUID().slice(0, 6);
const ids: string[] = [];
const fx = { orgId: "", planId: null as string | null, createdPlan: false };

async function candidate(email: string, first: string, last: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  ids.push(data.user.id);
  const at = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const { error: pErr } = await admin
    .from("profiles")
    .update({ first_name: first, last_name: last, country: "Nigeria", talent_verification_status: "verified", talent_verification_score: 88, talent_verified_at: at, talent_directory_opt_in: true, talent_available_for_hire: true, talent_remote_ready: true })
    .eq("id", data.user.id);
  if (pErr) throw new Error(`candidate profile: ${pErr.message}`);
  const { error: vErr } = await admin.from("talent_verifications").insert({ user_id: data.user.id, status: "verified", review_type: "ai", ai_score: 88, requested_at: at, decided_at: at });
  if (vErr) throw new Error(`candidate review: ${vErr.message}`);
  return data.user.id;
}

test.afterEach(async () => {
  await runCleanups(
    ["qa-excl subscription", async () => void (await admin.from("talent_directory_subscriptions").delete().eq("organization_id", fx.orgId))],
    ["qa-excl organisation", async () => { if (fx.orgId) await deleteOrgsCascade(admin, [fx.orgId]); }],
    ["qa-excl plan", async () => { if (fx.createdPlan && fx.planId) await admin.from("talent_directory_plans").delete().eq("id", fx.planId); }],
    ["qa-excl candidates", async () => { for (const id of ids.splice(0)) await admin.auth.admin.deleteUser(id).catch(() => {}); }],
  );
});

test("an ordinary listed candidate appears in the employer directory; a '+qa-' email and a name starting 'QA' do not", async ({ authedPage: page, testUser }, info) => {
  test.setTimeout(120_000);
  const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

  const { data: org, error: orgErr } = await admin.from("organizations").insert({ name: `E2E Employer Co qa-excl ${tag}`, created_by: testUser.id, verified: true }).select("id").single();
  if (orgErr || !org) throw new Error(`fixture org: ${orgErr?.message}`);
  fx.orgId = org.id;
  const { error: mErr } = await admin.from("organization_members").insert({ organization_id: fx.orgId, user_id: testUser.id, role: "owner" });
  if (mErr) throw new Error(`fixture membership: ${mErr.message}`);
  const { data: existingPlan } = await admin.from("talent_directory_plans").select("id").limit(1).maybeSingle();
  if (existingPlan) fx.planId = existingPlan.id;
  else {
    const { data: plan, error: planErr } = await admin.from("talent_directory_plans").insert({ name: `E2E plan ${tag}`, price_ngn: 1, duration_days: 30, is_active: true }).select("id").single();
    if (planErr || !plan) throw new Error(`fixture plan: ${planErr?.message}`);
    fx.planId = plan.id;
    fx.createdPlan = true;
  }
  const { error: sErr } = await admin.from("talent_directory_subscriptions").insert({ organization_id: fx.orgId, plan_id: fx.planId!, status: "active", expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString() });
  if (sErr) throw new Error(`fixture subscription: ${sErr.message}`);

  const domain = `${randomUUID().slice(0, 10)}.talentrah.test`;
  await candidate(`cand-${randomUUID()}@${domain}`, `Ordinary${tag}`, "Lister");
  await candidate(`hello+qa-cand-${randomUUID().slice(0, 8)}@${domain}`, `Plusqa${tag}`, "Lister");
  await candidate(`cand-${randomUUID()}@${domain}`, "QA", `Named${tag}`);

  await page.goto("/employer/talent-directory");
  await expect(page.getByRole("heading", { name: "Search candidates with a reviewed resume." })).toBeVisible();
  await shot("1-directory");

  await expect(page.locator("li", { hasText: `Ordinary${tag} Lister` }), "the ordinary candidate must be listed (fixture sanity)").toBeVisible();
  await expect(page.locator("li", { hasText: `Plusqa${tag} Lister` }), "a +qa- email must not be listed").toHaveCount(0);
  await expect(page.locator("li", { hasText: `QA Named${tag}` }), "a display name starting QA must not be listed").toHaveCount(0);
  await shot("2-only-the-ordinary-candidate");
});
