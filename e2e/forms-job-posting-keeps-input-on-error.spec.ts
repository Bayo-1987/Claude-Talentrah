/**
 * Forms sweep (QA, owner rule 8 Oct): /employer/jobs/new, the job posting form (employer, minted session; verified organisation created as the service role).
 * Rule: twice in a row, then once with an error. Post a job (redirects to Jobs Posted), open the form AGAIN: it must start empty; then post the SAME role in the SAME location
 * with a different description: the server answers "You've already posted this role in this location." and, after the form settles (3 s: React resets the form when the action
 * completes), the title, location and description the employer typed must still be there. Nothing is published twice. No job is posted on production: local stack only.
 */
import { randomUUID } from "node:crypto";
import { test, expect, admin } from "./fixtures/authed";
import { deleteOrgsCascade, deletePostingsCascade } from "../tests/support/delete-orgs";

const DESC = (n: number, tag: string) => `Version ${n} ${tag}: we are hiring a backend engineer to work on payment APIs. You will design services, write SQL queries, review code, and mentor other engineers.`;

test("job posting: the second visit starts clean, and a duplicate-post error keeps what was typed", async ({ authedPage: page, testUser }, info) => {
  test.setTimeout(150_000);
  const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  const tag = randomUUID().slice(0, 6);
  const title = `QA Form Rule Role ${tag}`;
  const { data: org } = await admin.from("organizations").insert({ name: `E2E Employer Co QAJ${tag}`, created_by: testUser.id, verified: true }).select("id").single();
  await admin.from("organization_members").insert({ organization_id: org!.id, user_id: testUser.id, role: "owner" });
  try {
    await page.goto("/employer/jobs/new");
    await page.getByLabel("Job title").fill(title);
    await page.getByLabel("Location").fill("Abuja, Nigeria");
    await page.getByLabel("Job description").fill(DESC(1, tag));
    await shot("1-first-post-filled");
    await page.getByRole("button", { name: "Publish job" }).click();
    await expect(page).toHaveURL(/\/employer\/jobs\?posted=.+$/, { timeout: 30_000 });

    await page.goto("/employer/jobs/new");
    await expect(page.getByLabel("Job title"), "the second visit starts with an empty title").toHaveValue("");
    expect(((await page.getByLabel("Job description").innerText()) || "").trim(), "...and an empty description").toBe("");

    await page.getByLabel("Job title").fill(title);
    await page.getByLabel("Location").fill("Abuja, Nigeria");
    await page.getByLabel("Job description").fill(DESC(2, tag));
    await page.getByLabel("Work type").selectOption("hybrid");
    await page.getByLabel("Employment type").selectOption("contract");
    await page.getByLabel("Minimum salary").fill("250000");
    await page.getByRole("button", { name: "Publish job" }).click();
    await expect(page.getByText(/already posted this role in this location/i)).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(3000); // let the action settle and React re-render the form
    await shot("2-duplicate-error-after-settling");
    await expect(page.getByLabel("Job title"), "the title is kept").toHaveValue(title);
    await expect(page.getByLabel("Location"), "the location is kept").toHaveValue("Abuja, Nigeria");
    await expect(page.getByLabel("Job description"), "the description is kept").toContainText(DESC(2, tag));
    await expect.soft(page.getByLabel("Work type"), "the work type is kept").toHaveValue("hybrid");
    await expect.soft(page.getByLabel("Employment type"), "the employment type is kept").toHaveValue("contract");
    await expect.soft(page.getByLabel("Minimum salary"), "the salary is kept").toHaveValue("250000");
    const { data: rows } = await admin.from("job_postings").select("id").eq("organization_id", org!.id).eq("title", title);
    expect(rows, "the duplicate was not published").toHaveLength(1);
  } finally {
    const { data: posts } = await admin.from("job_postings").select("id").eq("organization_id", org!.id);
    await deletePostingsCascade(admin, (posts ?? []).map((p) => p.id));
    await deleteOrgsCascade(admin, [org!.id]);
  }
});
