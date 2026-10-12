/**
 * Employer > Ad Campaigns: the whole money path through the real pages (QA, 9 Oct). Create a draft, edit and save it twice in a row ("Saved." each time), submit for review, approve it as a reviewer
 * would (database function, no admin UI), then: Resume with an empty wallet is refused with the balance in the message and nothing is charged; after a top-up (a wallet row written by the test: NO
 * payment provider is involved) Resume charges exactly one day and goes live; Pause then Resume on the same day charges NOTHING extra. The wallet and the ledger are read back each time. Local stack
 * only, minted session for a throwaway user, a verified throwaway organisation, removed afterwards.
 */
import { randomUUID } from "node:crypto";
import { test, expect, admin } from "./fixtures/authed";
import { deleteOrgsCascade, deletePostingsCascade } from "../tests/support/delete-orgs";
import { submitAndSettle } from "./support/form-keeps";
import { settle } from "./support/settle";

test("campaign: draft, edit twice, review, resume (refused, then charged once), pause, resume (no second charge)", async ({ authedPage: page, testUser }, info) => {
  test.setTimeout(180_000);
  const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  const tag = randomUUID().slice(0, 6);
  const { data: org } = await admin.from("organizations").insert({ name: `E2E Employer Co CL${tag}`, created_by: testUser.id, verified: true }).select("id").single();
  await admin.from("organization_members").insert({ organization_id: org!.id, user_id: testUser.id, role: "owner" });
  const { data: job, error } = await admin.from("job_postings").insert({ source_type: "internal", organization_id: org!.id, company_name: "QA Co", title: `QA Lifecycle Role ${tag}`, description: "x".repeat(120), location: "Lagos, Nigeria", work_type: "remote", employment_type: "full_time", structured_jd: { skills: ["sql"] }, status: "open", dedup_fingerprint: randomUUID() }).select("id").single();
  if (error || !job) throw new Error(`fixture job: ${error?.message}`);
  const campaign = async () => (await admin.from("ad_campaigns").select("id, name, status, daily_rate_ngn, total_budget_ngn, spent_ngn, last_charged_on").eq("organization_id", org!.id).single()).data;
  const wallet = async () => (await admin.from("ad_wallets").select("balance_ngn").eq("organization_id", org!.id).maybeSingle()).data?.balance_ngn ?? 0;
  const charges = async () => ((await admin.from("ad_wallet_ledger").select("id").eq("organization_id", org!.id).eq("reason", "campaign_charge")).data ?? []).length;
  try {
    await page.goto("/employer/campaigns/new");
    await page.getByLabel("Campaign name").fill(`QA Lifecycle ${tag}`);
    await page.locator("select[name=jobPostingId]").selectOption(job.id);
    await page.getByLabel(/Daily budget/).fill("1000");
    await page.getByLabel(/Total budget/).fill("5000");
    await shot("1-new-filled");
    await page.getByRole("button", { name: "Create draft" }).click();
    await page.waitForURL(/\/employer\/campaigns\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    expect(await campaign()).toMatchObject({ name: `QA Lifecycle ${tag}`, status: "draft", daily_rate_ngn: 1000, total_budget_ngn: 5000, spent_ngn: 0 });

    for (const [i, name] of [`QA Lifecycle edited ${tag}`, `QA Lifecycle edited again ${tag}`].entries()) {
      await page.getByLabel("Campaign name").fill(name);
      await submitAndSettle(page, () => page.getByRole("button", { name: "Save changes" }).click());
      await expect.poll(async () => (await campaign())?.name, { timeout: 30_000 }).toBe(name);
      await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
      await settle(page);
      if (i === 0) await shot("2-first-save");
    }

    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect.poll(async () => (await campaign())?.status, { timeout: 30_000 }).toBe("pending_review");
    await shot("3-pending-review");
    const c0 = (await campaign())!;
    await admin.rpc("set_ad_campaign_review", { p_campaign_id: c0.id, p_approve: true, p_reviewer_id: testUser.id as string });
    expect((await campaign())?.status, "approval parks it paused, never live").toBe("paused_by_employer");
    await page.reload();

    // Resume with an empty wallet: refused, with the balance, nothing charged.
    await page.getByRole("button", { name: /Resume/ }).click();
    await expect(page.getByText(/doesn't have enough to cover a day/)).toBeVisible({ timeout: 30_000 });
    await shot("4-refused-no-funds");
    expect(await charges()).toBe(0);
    expect((await campaign())?.spent_ngn).toBe(0);

    // Top-up written by the test (no provider), then Resume charges exactly one day.
    await admin.from("ad_wallets").upsert({ organization_id: org!.id, balance_ngn: 3000 });
    await page.reload();
    await page.getByRole("button", { name: /Resume/ }).click();
    await expect.poll(async () => (await campaign())?.status, { timeout: 30_000 }).toBe("active");
    expect(await wallet(), "one day charged").toBe(2000);
    expect(await charges()).toBe(1);
    expect((await campaign())?.spent_ngn).toBe(1000);
    await shot("5-live");

    // Pause, then Resume the same day: no second charge.
    await page.getByRole("button", { name: "Pause campaign" }).click();
    await expect.poll(async () => (await campaign())?.status, { timeout: 30_000 }).toBe("paused_by_employer");
    await page.getByRole("button", { name: /Resume/ }).click();
    await expect.poll(async () => (await campaign())?.status, { timeout: 30_000 }).toBe("active");
    expect(await wallet(), "no second charge for the same day").toBe(2000);
    expect(await charges()).toBe(1);
    expect((await campaign())?.spent_ngn).toBe(1000);
  } finally {
    await deletePostingsCascade(admin, [job.id]);
    await deleteOrgsCascade(admin, [org!.id]);
  }
});
