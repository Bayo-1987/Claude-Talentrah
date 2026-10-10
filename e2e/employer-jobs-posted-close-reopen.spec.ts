/**
 * Employer > Jobs Posted: close and reopen (QA, 9 Oct). Close, reopen, close again in a row: each time the badge and the button follow, the database follows, and the PUBLIC posting page follows
 * (an open posting is served; a closed one still answers 200 but says "This posting is no longer open"). The close/reopen buttons are plain forms with no message, so the visible evidence is the badge and the button label.
 * Local stack only, minted session for a throwaway user, a verified throwaway organisation with one open posting, removed afterwards.
 */
import { randomUUID } from "node:crypto";
import { test, expect, admin } from "./fixtures/authed";
import { deleteOrgsCascade, deletePostingsCascade } from "../tests/support/delete-orgs";

test("Jobs Posted: close, reopen, close; badge, button, database and the public page follow", async ({ authedPage: page, testUser }, info) => {
  test.setTimeout(120_000);
  const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  const tag = randomUUID().slice(0, 6);
  const { data: org } = await admin.from("organizations").insert({ name: `E2E Employer Co CR${tag}`, created_by: testUser.id, verified: true }).select("id").single();
  await admin.from("organization_members").insert({ organization_id: org!.id, user_id: testUser.id, role: "owner" });
  const { data: job, error } = await admin.from("job_postings").insert({ source_type: "internal", organization_id: org!.id, company_name: "QA Co", title: `QA Close Reopen ${tag}`, description: "x".repeat(120), location: "Lagos, Nigeria", work_type: "remote", employment_type: "full_time", structured_jd: { skills: ["sql"] }, status: "open", dedup_fingerprint: randomUUID() }).select("id").single();
  if (error || !job) throw new Error(`fixture job: ${error?.message}`);
  const status = async () => (await admin.from("job_postings").select("status").eq("id", job.id).single()).data?.status;
  const publicState = async () => (await page.request.get(`/jobs/${job.id}`)).status();
  const publicText = async () => (await (await page.request.get(`/jobs/${job.id}`)).text());
  try {
    await page.goto("/employer/jobs");
    const row = () => page;
    await expect(page.getByRole("heading", { name: `QA Close Reopen ${tag}` })).toBeVisible();
    expect(await publicState(), "an open posting is served").toBe(200);
    expect(await publicText()).not.toContain("This posting is no longer open");

    await row().getByRole("button", { name: "Close", exact: true }).click();
    await expect.poll(status, { timeout: 30_000 }).toBe("closed");
    await expect(row().getByText("Closed", { exact: true })).toBeVisible();
    await expect(row().getByRole("button", { name: "Reopen" })).toBeVisible();
    await shot("1-closed");
    expect(await publicText(), "closed: the public page says the posting is no longer open").toContain("This posting is no longer open");

    await row().getByRole("button", { name: "Reopen" }).click();
    await expect.poll(status, { timeout: 30_000 }).toBe("open");
    await expect(row().getByRole("button", { name: "Close", exact: true })).toBeVisible();
    await expect(row().getByText("Closed", { exact: true })).toHaveCount(0);
    expect(await publicState(), "reopened: served again").toBe(200);
    expect(await publicText(), "reopened: the public page no longer says it is closed").not.toContain("This posting is no longer open");

    await row().getByRole("button", { name: "Close", exact: true }).click();
    await expect.poll(status, { timeout: 30_000 }).toBe("closed");
    await expect(row().getByText("Closed", { exact: true })).toBeVisible();
    await shot("3-closed-again");
  } finally {
    await deletePostingsCascade(admin, [job.id]);
    await deleteOrgsCascade(admin, [org!.id]);
  }
});
