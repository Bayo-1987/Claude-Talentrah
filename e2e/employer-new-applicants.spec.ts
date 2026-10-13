/**
 * New-applicant notifications (0254, 0259) through the real UI: Jobs Posted shows "N new" next to the application count and the setting control saves instant / daily digest / off; the applicants page
 * shows "N new" for applicants with no status yet and the badge goes away once the employer sets a status. (The emails themselves are covered on a real database in tests/employer/new-applicants.)
 */
import { test, expect, admin } from "./fixtures/authed";
import { randomUUID } from "node:crypto";
import { deleteOrgsCascade } from "../tests/support/delete-orgs";

test.describe("new applicants on Jobs Posted and the applicants page", () => {
  const orgIds: string[] = [];
  const users: string[] = [];

  test.afterEach(async () => {
    if (orgIds.length) await deleteOrgsCascade(admin, orgIds.splice(0));
    for (const id of users.splice(0)) await admin.auth.admin.deleteUser(id);
  });

  async function fixture(ownerId: string, applicants: number) {
    const { data: org, error } = await admin
      .from("organizations")
      .insert({ name: `E2E Employer Co newapp ${randomUUID().slice(0, 8)}`, created_by: ownerId, verified: true })
      .select("id, name")
      .single();
    if (error || !org) throw new Error(`org: ${error?.message}`);
    orgIds.push(org.id);
    await admin.from("organization_members").insert({ organization_id: org.id, user_id: ownerId, role: "owner" });
    const { data: job, error: jobError } = await admin
      .from("job_postings")
      .insert({ source_type: "internal", organization_id: org.id, company_name: org.name, title: "Growth Marketer", description: "E2E fixture.", structured_jd: {}, status: "open", posted_at: new Date().toISOString(), dedup_fingerprint: randomUUID() })
      .select("id")
      .single();
    if (jobError || !job) throw new Error(`job: ${jobError?.message}`);
    const applicationIds: string[] = [];
    for (let i = 0; i < applicants; i += 1) {
      const { data: created, error: userError } = await admin.auth.admin.createUser({ email: `e2e-newapp-${randomUUID().slice(0, 8)}@talentrah.test`, email_confirm: true });
      if (userError || !created.user) throw new Error(`applicant: ${userError?.message}`);
      users.push(created.user.id);
      await admin.from("profiles").update({ first_name: `Applicant${i + 1}`, last_name: "Test" }).eq("id", created.user.id);
      const { data: app, error: appError } = await admin
        .from("applications")
        .insert({ user_id: created.user.id, job_posting_id: job.id, stage: "applied", source: "internal_apply", applied_at: new Date().toISOString() })
        .select("id")
        .single();
      if (appError || !app) throw new Error(`application: ${appError?.message}`);
      applicationIds.push(app.id);
    }
    return { jobId: job.id, applicationIds };
  }

  test("Jobs Posted shows '3 new' and the setting saves; the applicants page shows '3 new' and a status change takes one away", async ({ authedPage: page, testUser }) => {
    const { jobId, applicationIds } = await fixture(testUser.id, 3);

    await page.goto("/employer/jobs");
    await expect(page.getByText("3 applications")).toBeVisible();
    await expect(page.getByRole("link", { name: "3 new" })).toBeVisible();

    const select = page.getByLabel("Emails about new applicants");
    await expect(select).toHaveValue("instant");
    await select.selectOption("digest");
    await expect.poll(async () => (await admin.from("email_preferences").select("new_applicant_notice").eq("user_id", testUser.id).single()).data?.new_applicant_notice).toBe("digest");
    await page.reload();
    await expect(page.getByLabel("Emails about new applicants")).toHaveValue("digest");

    await page.goto(`/employer/jobs/${jobId}/applicants`);
    await expect(page.getByText("3 new", { exact: true })).toBeVisible();
    await admin.from("employer_applicant_status").upsert({ application_id: applicationIds[0], status: "reviewing" });
    await page.reload();
    await expect(page.getByText("2 new", { exact: true })).toBeVisible();

    await page.goto("/employer/jobs");
    await expect(page.getByRole("link", { name: "2 new" })).toBeVisible();
  });

  test("no badge when every applicant has a status", async ({ authedPage: page, testUser }) => {
    const { applicationIds } = await fixture(testUser.id, 1);
    await admin.from("employer_applicant_status").upsert({ application_id: applicationIds[0], status: "shortlisted" });
    await page.goto("/employer/jobs");
    await expect(page.getByText("1 application", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /\d+ new/ })).toHaveCount(0);
  });
});
