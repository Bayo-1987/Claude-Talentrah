/**
 * Forms sweep (QA, owner rule 8 Oct): /employer/campaigns/new, the ad campaign form (employer, minted session; verified organisation, an open job and nothing else created as the
 * service role). REPORT-ONLY item: money is involved, so this spec only exercises a refused submission and creates no campaign and charges nothing. Deliberate error: a total budget
 * below the daily budget ("The total budget has to cover at least one day."). After the form settles (3 s: React resets the form when the action completes) the name, job choice, both
 * budgets and the target locations typed must still be there. Local stack only.
 */
import { randomUUID } from "node:crypto";
import { test, expect, admin } from "./fixtures/authed";
import { deleteOrgsCascade, deletePostingsCascade } from "../tests/support/delete-orgs";
import { submitAndSettle, expectStaysFor } from "./support/form-keeps";

test("campaign form: a budget error keeps what was typed (no campaign is created)", async ({ authedPage: page, testUser }, info) => {
  const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  const tag = randomUUID().slice(0, 6);
  const { data: org } = await admin.from("organizations").insert({ name: `E2E Employer Co QAK${tag}`, created_by: testUser.id, verified: true }).select("id").single();
  await admin.from("organization_members").insert({ organization_id: org!.id, user_id: testUser.id, role: "owner" });
  const { data: job, error } = await admin.from("job_postings").insert({ source_type: "internal", organization_id: org!.id, company_name: "QA Co", title: `QA Campaign Role ${tag}`, description: "x".repeat(120), location: "Lagos, Nigeria", work_type: "remote", employment_type: "full_time", structured_jd: { skills: ["sql"] }, status: "open", dedup_fingerprint: randomUUID() }).select("id").single();
  if (error || !job) throw new Error(`fixture job: ${error?.message}`);
  try {
    await page.goto("/employer/campaigns/new");
    await page.getByLabel("Campaign name").fill(`QA Campaign ${tag}`);
    await page.locator("select[name=jobPostingId]").selectOption(job.id);
    await page.getByLabel(/Daily budget/).fill("5000");
    await page.getByLabel(/Total budget/).fill("1000");
    await page.getByLabel(/Target locations/).fill("Lagos, Abuja");
    await shot("1-filled-total-below-daily");
    await submitAndSettle(page, () => page.locator("form", { has: page.getByLabel("Campaign name") }).locator("button[type=submit]").click());
    await expect(page.getByText(/total budget has to cover at least one day/i)).toBeVisible({ timeout: 15_000 });
    await shot("2-error-after-settling");
    await expectStaysFor(async () => ({ name: await page.getByLabel("Campaign name").inputValue(), job: await page.locator("select[name=jobPostingId]").inputValue(), daily: await page.getByLabel(/Daily budget/).inputValue(), total: await page.getByLabel(/Total budget/).inputValue(), locations: await page.getByLabel(/Target locations/).inputValue() }), { name: `QA Campaign ${tag}`, job: job.id, daily: "5000", total: "1000", locations: "Lagos, Abuja" }, "after a refused submission the typed values stay in the form, throughout");
    const { count } = await admin.from("ad_campaigns").select("id", { count: "exact", head: true }).eq("organization_id", org!.id);
    expect(count, "no campaign was created").toBe(0);
  } finally {
    await deletePostingsCascade(admin, [job.id]);
    await deleteOrgsCascade(admin, [org!.id]);
  }
});
