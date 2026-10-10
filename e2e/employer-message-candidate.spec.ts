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
});
