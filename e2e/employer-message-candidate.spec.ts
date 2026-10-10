/**
 * "Message candidate" (0256) through the real UI: the page opens for the employer's own applicant, a template fills the boxes, the candidate's address is nowhere on the page,
 * a send that cannot be delivered says so and KEEPS what was typed, and another organisation's applicant is a plain 404.
 *
 * The test app has no mail provider key, so a send ends in the "could not be sent" path on purpose: that is the path where losing the employer's text would hurt, and the delivered
 * path (Reply-To, log row, the 20-a-day limit) is covered on a real database in tests/employer/send-applicant-message-action.test.ts.
 */
import { test, expect, admin } from "./fixtures/authed";
import { randomUUID } from "node:crypto";
import { deleteOrgsCascade } from "../tests/support/delete-orgs";
import { FARAH_MESSAGE_DRAFT_NGN } from "../src/lib/billing/catalog";

test.describe("Message candidate", () => {
  const orgIds: string[] = [];
  const extraUsers: string[] = [];

  test.afterEach(async () => {
    if (orgIds.length) await deleteOrgsCascade(admin, orgIds.splice(0));
    for (const id of extraUsers.splice(0)) await admin.auth.admin.deleteUser(id);
  });

  async function org(ownerId: string, label: string) {
    const { data, error } = await admin
      .from("organizations")
      .insert({ name: `E2E Employer Co msg ${label} ${randomUUID().slice(0, 8)}`, created_by: ownerId, verified: true })
      .select("id, name")
      .single();
    if (error || !data) throw new Error(`org: ${error?.message}`);
    orgIds.push(data.id);
    const member = await admin.from("organization_members").insert({ organization_id: data.id, user_id: ownerId, role: "owner" });
    if (member.error) throw new Error(`member: ${member.error.message}`);
    const { data: job, error: jobError } = await admin
      .from("job_postings")
      .insert({
        source_type: "internal",
        organization_id: data.id,
        company_name: data.name,
        title: `Growth Marketer ${label}`,
        description: "E2E fixture posting.",
        structured_jd: {},
        status: "open",
        posted_at: new Date().toISOString(),
        dedup_fingerprint: randomUUID(),
      })
      .select("id")
      .single();
    if (jobError || !job) throw new Error(`job: ${jobError?.message}`);
    return { orgId: data.id, orgName: data.name, jobId: job.id };
  }

  async function applicant(jobId: string) {
    const email = `e2e-applicant-${randomUUID().slice(0, 8)}@candidate-mail.example`;
    const { data: created, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (error || !created.user) throw new Error(`applicant: ${error?.message}`);
    extraUsers.push(created.user.id);
    await admin.from("profiles").update({ first_name: "Joy", last_name: "Akindele" }).eq("id", created.user.id);
    const { data: app, error: appError } = await admin
      .from("applications")
      .insert({ user_id: created.user.id, job_posting_id: jobId, stage: "applied", source: "internal_apply", applied_at: new Date().toISOString() })
      .select("id")
      .single();
    if (appError || !app) throw new Error(`application: ${appError?.message}`);
    return { applicationId: app.id, email };
  }

  test("a template fills the boxes, a send that cannot be delivered keeps the text, and the candidate's address is never on the page", async ({ authedPage: page, testUser }) => {
    const mine = await org(testUser.id, "own");
    const joy = await applicant(mine.jobId);

    await page.goto(`/employer/jobs/${mine.jobId}/applicants/${joy.applicationId}/message`);
    await expect(page.getByRole("heading", { name: "Message Joy Akindele" })).toBeVisible();
    await expect(page.getByText(`Their reply comes to your email (${testUser.email})`)).toBeVisible();
    await expect(page.getByText("20 of 20 messages left today.")).toBeVisible();

    await page.getByRole("button", { name: "Invite to interview" }).click();
    await expect(page.getByLabel("Subject")).toHaveValue(`Interview for Growth Marketer own at ${mine.orgName}`);
    await expect(page.getByLabel("Message")).toHaveValue(/^Hi Joy,/);

    await page.getByLabel("Message").fill("Hi Joy,\n\nOur own words, typed by the employer.");
    await page.getByRole("button", { name: "Send message" }).click();

    await expect(page.getByText(/could not be sent/)).toBeVisible();
    await expect(page.getByLabel("Message"), "a refusal keeps what was typed").toHaveValue("Hi Joy,\n\nOur own words, typed by the employer.");
    await expect(page.getByLabel("Subject")).toHaveValue(`Interview for Growth Marketer own at ${mine.orgName}`);
    await expect(page.getByText("20 of 20 messages left today."), "a failed send does not use up the day").toBeVisible();

    expect(await page.content(), "the candidate's address is not anywhere in the page").not.toContain("candidate-mail.example");
    const { data: rows } = await admin.from("applicant_messages").select("status").eq("organization_id", mine.orgId);
    expect(rows).toEqual([{ status: "failed" }]);
  });

  test("another organisation's applicant is a 404, and so is an application that is not on this job", async ({ authedPage: page, testUser }) => {
    const mine = await org(testUser.id, "own");
    const { data: other } = await admin.auth.admin.createUser({ email: `e2e-other-${randomUUID().slice(0, 8)}@talentrah.test`, email_confirm: true });
    extraUsers.push(other.user!.id);
    const theirs = await org(other.user!.id, "theirs");
    const stranger = await applicant(theirs.jobId);

    // Inside the signed-in layout the not-found page streams with a 200 status line, so the proof is what is on the page: the not-found heading and no form.
    await page.goto(`/employer/jobs/${theirs.jobId}/applicants/${stranger.applicationId}/message`);
    await expect(page.getByRole("heading", { name: "This page doesn't exist." })).toBeVisible();
    await expect(page.getByLabel("Message")).toHaveCount(0);
    await page.goto(`/employer/jobs/${mine.jobId}/applicants/${stranger.applicationId}/message`);
    await expect(page.getByRole("heading", { name: "This page doesn't exist." }), "the application is not on the job in the URL").toBeVisible();
    await expect(page.getByLabel("Message")).toHaveCount(0);
  });

  test("a free plan sees the Premium note instead of Farah; a Premium employer gets a draft in the boxes, pays from the ad wallet, and nothing is sent", async ({ authedPage: page, testUser }) => {
    const mine = await org(testUser.id, "own");
    const joy = await applicant(mine.jobId);
    const url = `/employer/jobs/${mine.jobId}/applicants/${joy.applicationId}/message`;

    await page.goto(url);
    await expect(page.getByText("Draft or refine with Farah is part of Premium.")).toBeVisible();
    await expect(page.getByRole("link", { name: "See Premium" })).toBeVisible();
    await expect(page.getByLabel("Notes for Farah (optional)")).toHaveCount(0);

    const { error: premiumError } = await admin.rpc("admin_set_organization_premium", {
      p_organization_id: mine.orgId,
      p_premium_until: new Date(Date.now() + 86_400_000).toISOString(),
      p_admin_user_id: null as unknown as string,
      p_admin_email: "operator@talentrah.internal",
      p_admin_session_id: null as unknown as string,
      p_reason: "e2e fixture",
    });
    expect(premiumError).toBeNull();
    await admin.from("ad_wallets").upsert({ organization_id: mine.orgId, balance_ngn: 500 }, { onConflict: "organization_id" });

    await page.goto(url);
    await expect(page.getByText("Draft or refine with Farah is part of Premium.")).toHaveCount(0);
    await page.getByLabel("Notes for Farah (optional)").fill("Ask for two times next week.");
    await page.getByRole("button", { name: "Draft with Farah" }).click();
    await expect(page.getByText("drafted this from your notes and the job. Review it before sending.")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel("Subject")).not.toHaveValue("");
    await expect(page.getByLabel("Message")).not.toHaveValue("");
    await expect(page.getByRole("button", { name: "Refine with Farah" })).toBeVisible();

    const { data: wallet } = await admin.from("ad_wallets").select("balance_ngn").eq("organization_id", mine.orgId).single();
    expect(wallet?.balance_ngn).toBe(500 - FARAH_MESSAGE_DRAFT_NGN);
    const { count } = await admin.from("applicant_messages").select("id", { count: "exact", head: true }).eq("organization_id", mine.orgId);
    expect(count ?? 0, "drafting sends and logs nothing").toBe(0);
    expect(await page.content()).not.toContain("candidate-mail.example");
  });

  test("a double click on Draft with Farah is ONE draft and ONE charge; a double click on Send is ONE message", async ({ authedPage: page, testUser }) => {
    const mine = await org(testUser.id, "own");
    const joy = await applicant(mine.jobId);
    const { error: premiumError } = await admin.rpc("admin_set_organization_premium", {
      p_organization_id: mine.orgId,
      p_premium_until: new Date(Date.now() + 86_400_000).toISOString(),
      p_admin_user_id: null as unknown as string,
      p_admin_email: "operator@talentrah.internal",
      p_admin_session_id: null as unknown as string,
      p_reason: "e2e fixture",
    });
    expect(premiumError).toBeNull();
    await admin.from("ad_wallets").upsert({ organization_id: mine.orgId, balance_ngn: 500 }, { onConflict: "organization_id" });

    await page.goto(`/employer/jobs/${mine.jobId}/applicants/${joy.applicationId}/message`);
    await page.getByRole("button", { name: "Draft with Farah" }).dblclick();
    await expect(page.getByText("drafted this from your notes and the job. Review it before sending.")).toBeVisible({ timeout: 30_000 });
    // Let anything a second click might still have started finish before counting.
    await page.waitForTimeout(1500);
    const { data: ledger } = await admin.from("ad_wallet_ledger").select("reason, delta_ngn").eq("organization_id", mine.orgId);
    expect(ledger, "one click or two, exactly one charge").toEqual([{ reason: "farah_message_draft_charge", delta_ngn: -FARAH_MESSAGE_DRAFT_NGN }]);

    await page.getByRole("button", { name: "Send message" }).dblclick();
    await expect(page.getByText(/could not be sent|Message sent/)).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    const { count } = await admin.from("applicant_messages").select("id", { count: "exact", head: true }).eq("organization_id", mine.orgId);
    expect(count, "one click or two, exactly one message attempt").toBe(1);
  });
});
