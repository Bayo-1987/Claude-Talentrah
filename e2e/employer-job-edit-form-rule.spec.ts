/**
 * Employer > Jobs Posted > Edit: the form rule (QA, 9 Oct). Save the posting twice in a row (each save lands on Jobs Posted with the new title; the database follows; reopening the editor shows the saved
 * values, not stale ones), then once with a deliberate error (a description too short to be real): the error is shown, the posting is untouched, and the title and the description typed are still in the form.
 * Local stack only, minted session for a throwaway user, a verified throwaway organisation with one open posting, removed afterwards.
 */
import { randomUUID } from "node:crypto";
import { test, expect, admin } from "./fixtures/authed";
import { deleteOrgsCascade, deletePostingsCascade } from "../tests/support/delete-orgs";
import { submitAndSettle } from "./support/form-keeps";
import { settle } from "./support/settle";

const DESC = (n: number, tag: string) => `Edit ${n} ${tag}: we are hiring a backend engineer to work on payment APIs. You will design services, write SQL queries, review code, and mentor other engineers.`;

test("edit job: two saves in a row, then a too-short description keeps what was typed", async ({ authedPage: page, testUser }, info) => {
  test.setTimeout(150_000);
  const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  const tag = randomUUID().slice(0, 6);
  const { data: org } = await admin.from("organizations").insert({ name: `E2E Employer Co ED${tag}`, created_by: testUser.id, verified: true }).select("id").single();
  await admin.from("organization_members").insert({ organization_id: org!.id, user_id: testUser.id, role: "owner" });
  const { data: job, error } = await admin.from("job_postings").insert({ source_type: "internal", organization_id: org!.id, company_name: "QA Co", title: `QA Edit Role ${tag}`, description: DESC(0, tag), location: "Lagos, Nigeria", work_type: "remote", employment_type: "full_time", structured_jd: { skills: ["sql"] }, status: "open", dedup_fingerprint: randomUUID() }).select("id").single();
  if (error || !job) throw new Error(`fixture job: ${error?.message}`);
  const row = async () => (await admin.from("job_postings").select("title, description").eq("id", job.id).single()).data;
  try {
    for (const n of [1, 2]) {
      await page.goto(`/employer/jobs/${job.id}/edit`);
      await expect(page.getByLabel("Job title")).toHaveValue(n === 1 ? `QA Edit Role ${tag}` : `QA Edit Role ${n - 1} ${tag}`);
      await page.getByLabel("Job title").fill(`QA Edit Role ${n} ${tag}`);
      await page.getByLabel("Job description").fill(DESC(n, tag));
      await submitAndSettle(page, () => page.getByRole("button", { name: "Save changes" }).click());
      await page.waitForURL(/\/employer\/jobs(\?|$)/, { timeout: 30_000 });
      await expect.poll(async () => (await row())?.title, { timeout: 30_000 }).toBe(`QA Edit Role ${n} ${tag}`);
      expect((await row())?.description).toContain(`Edit ${n} ${tag}`);
      await expect(page.getByRole("heading", { name: `QA Edit Role ${n} ${tag}` })).toBeVisible();
      if (n === 1) await shot("1-first-save");
    }

    // Deliberate error: a one-word description.
    await page.goto(`/employer/jobs/${job.id}/edit`);
    await page.getByLabel("Job title").fill(`QA Edit Role bad ${tag}`);
    await page.getByLabel("Job description").fill("Too short");
    await submitAndSettle(page, () => page.getByRole("button", { name: "Save changes" }).click());
    await expect(page.getByText(/Add a real job description/)).toBeVisible({ timeout: 30_000 });
    await shot("3-error");
    await settle(page);
    expect((await row())?.title, "posting untouched").toBe(`QA Edit Role 2 ${tag}`);
    await expect(page.getByLabel("Job title"), "EDIT-KEEP-1: the title typed is kept").toHaveValue(`QA Edit Role bad ${tag}`);
    await expect(page.getByLabel("Job description"), "EDIT-KEEP-1: the description typed is kept").toContainText("Too short");
  } finally {
    await deletePostingsCascade(admin, [job.id]);
    await deleteOrgsCascade(admin, [org!.id]);
  }
});
