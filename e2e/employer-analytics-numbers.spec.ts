/**
 * Employer > Analytics: the numbers are the right numbers (QA, 9 Oct). Campaign A has 7 impressions, 3 clicks and 1 apply; campaign B has 2 impressions; a campaign of ANOTHER organisation has
 * events too and must not appear or be counted. The totals row (9 / 3 / 1, and "Spent to date" = the sum of the campaigns' spend), each campaign's own line and its CTR (3/7 = 42.9%, B 0.0%), and the
 * Details page of A are read off the real page. Events are written as the service role (the event pipeline is not under test). Local stack only; throwaway organisations removed afterwards.
 */
import { randomUUID } from "node:crypto";
import { test, expect, admin } from "./fixtures/authed";
import { deleteOrgsCascade, deletePostingsCascade } from "../tests/support/delete-orgs";

test("analytics: totals, per-campaign lines and CTR match the events; another organisation's events are not shown", async ({ authedPage: page, testUser }, info) => {
  test.setTimeout(120_000);
  const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  const tag = randomUUID().slice(0, 6);
  const mkOrg = async (label: string) => {
    const { data } = await admin.from("organizations").insert({ name: `E2E Employer Co AN${label}${tag}`, created_by: testUser.id, verified: true }).select("id").single();
    return data!.id;
  };
  const orgId = await mkOrg("M");
  const otherOrg = await mkOrg("O");
  await admin.from("organization_members").insert({ organization_id: orgId, user_id: testUser.id, role: "owner" });
  const mkJob = async (org: string, title: string) => {
    const { data, error } = await admin.from("job_postings").insert({ source_type: "internal", organization_id: org, company_name: "QA Co", title, description: "x".repeat(120), location: "Lagos, Nigeria", work_type: "remote", employment_type: "full_time", structured_jd: { skills: ["sql"] }, status: "open", dedup_fingerprint: randomUUID() }).select("id").single();
    if (error || !data) throw new Error(`fixture job: ${error?.message}`);
    return data.id;
  };
  const jobA = await mkJob(orgId, `QA Analytics A ${tag}`);
  const jobB = await mkJob(orgId, `QA Analytics B ${tag}`);
  const jobO = await mkJob(otherOrg, `QA Analytics Other ${tag}`);
  const mkCampaign = async (org: string, job: string, name: string, spent: number) => {
    const { data, error } = await admin.from("ad_campaigns").insert({ organization_id: org, job_posting_id: job, name, status: "paused_by_employer", daily_rate_ngn: 1000, total_budget_ngn: 10000, spent_ngn: spent, created_by: testUser.id }).select("id").single();
    if (error || !data) throw new Error(`fixture campaign: ${error?.message}`);
    return data.id;
  };
  const campA = await mkCampaign(orgId, jobA, `QA Camp A ${tag}`, 2000);
  const campB = await mkCampaign(orgId, jobB, `QA Camp B ${tag}`, 1000);
  const campO = await mkCampaign(otherOrg, jobO, `QA Camp Other ${tag}`, 7000);
  const events = async (campaignId: string, jobId: string, type: "impression" | "click" | "apply", n: number) => {
    const rows = Array.from({ length: n }, (_, i) => ({ campaign_id: campaignId, job_posting_id: jobId, event_type: type, user_id: testUser.id, dedup_bucket: `${type}-${tag}-${i}` }));
    const { error } = await admin.from("ad_events").insert(rows);
    if (error) throw new Error(`fixture events: ${error.message}`);
  };
  await events(campA, jobA, "impression", 7); await events(campA, jobA, "click", 3); await events(campA, jobA, "apply", 1);
  await events(campB, jobB, "impression", 2);
  await events(campO, jobO, "impression", 50); await events(campO, jobO, "click", 20);
  try {
    await page.goto("/employer/analytics");
    await shot("1-analytics");
    await expect(page.getByText("Spent to date"), "the page has rendered its totals").toBeVisible({ timeout: 30_000 });
    const totals = (await page.locator("body").innerText()).toLowerCase();
    expect(totals).toMatch(/impressions\s*9\s*clicks\s*3\s*applies\s*1\s*spent to date\s*.*3,000/);
    const lineA = page.locator("div", { hasText: `QA Camp A ${tag}` }).filter({ hasText: "impressions" }).last();
    await expect(lineA).toContainText("7 impressions");
    await expect(lineA).toContainText("3 clicks");
    await expect(lineA).toContainText("1 applies");
    await expect(lineA).toContainText("42.9% CTR");
    const lineB = page.locator("div", { hasText: `QA Camp B ${tag}` }).filter({ hasText: "impressions" }).last();
    await expect(lineB).toContainText("2 impressions");
    await expect(lineB).toContainText("0.0% CTR");
    await expect(page.getByText(`QA Camp Other ${tag}`), "another organisation's campaign must not be listed").toHaveCount(0);

    await page.goto(`/employer/campaigns/${campA}/analytics`);
    await shot("2-details");
    await expect(page.getByText(/42\.9%/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("body")).toContainText(/impressions/i);
    // The other organisation's campaign page is not reachable.
    await page.goto(`/employer/campaigns/${campO}/analytics`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(`QA Camp Other ${tag}`), "another organisation's campaign analytics must not open").toHaveCount(0);
    await expect(page.getByText(/\b50\b/), "its 50 impressions must not be shown").toHaveCount(0);
  } finally {
    await deletePostingsCascade(admin, [jobA, jobB, jobO]);
    await deleteOrgsCascade(admin, [orgId, otherOrg]);
  }
});
