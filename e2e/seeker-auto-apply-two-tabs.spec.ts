/**
 * Auto-Apply: "Confirm and apply" pressed on the SAME queued match in two tabs at the same instant (QA, 9 Oct). Exactly ONE application, ONE submitted queue row, ONE credit decision; neither tab shows a crash
 * screen. Then the other half: "Not this one" in one tab and "Confirm" in the other: whichever wins, the database is consistent (not both an application and a dismissal). Local stack only, minted session,
 * seeded match and queue (service role, as the existing auto-apply.spec does).
 */
import { randomUUID } from "node:crypto";
import { test, expect, admin, seedBaseResume } from "./fixtures/authed";
import { deleteOrgsCascade, deletePostingsCascade } from "../tests/support/delete-orgs";
import { settle } from "./support/settle";

/** The next Server Action POST this page makes: started BEFORE the click so the response cannot be missed. */
const actionResponse = (p: import("@playwright/test").Page) =>
  p.waitForResponse((r) => r.request().method() === "POST" && r.request().headers()["next-action"] !== undefined, { timeout: 45_000 });

async function seed(userId: string, orgId: string) {
  await seedBaseResume(userId);
  const tag = randomUUID().slice(0, 6);
  const picked: Array<{ id: string; title: string }> = [];
  for (const n of [1, 2]) {
    const { data, error } = await admin.from("job_postings").insert({ source_type: "internal", organization_id: orgId, company_name: "QA Co", title: `QA AutoApply Role ${n} ${tag}`, description: "x".repeat(120), location: "Lagos, Nigeria", work_type: "remote", employment_type: "full_time", structured_jd: { skills: ["sql"] }, status: "open", dedup_fingerprint: randomUUID() }).select("id, title").single();
    if (error || !data) throw new Error(`fixture job: ${error?.message}`);
    picked.push(data);
  }
  for (const j of picked) {
    await admin.from("match_scores").upsert({ user_id: userId, job_posting_id: j.id, score: 95, tier: "excellent", explanation: { matchedSkills: ["sql", "python", "leadership", "stakeholder management"], missingSkills: ["kubernetes"], seniorityAlignment: "match" } }, { onConflict: "user_id,job_posting_id" });
    await admin.from("auto_apply_queue").insert({ user_id: userId, job_posting_id: j.id, match_score: 95, tier: "excellent", source_type: "internal", status: "pending" });
  }
  await admin.from("auto_apply_settings").upsert({ user_id: userId, enabled: true, enabled_at: new Date().toISOString() }, { onConflict: "user_id" });
  return picked;
}

test("auto-apply: two tabs confirming the same match make one application; confirm vs dismiss stays consistent", async ({ authedPage: page, testUser }, info) => {
  test.setTimeout(150_000);
  const { data: org } = await admin.from("organizations").insert({ name: `E2E Employer Co AA${testUser.id.slice(0, 6)}`, created_by: testUser.id, verified: true }).select("id").single();
  const jobs = await seed(testUser.id, org!.id);
  const [j1, j2] = jobs;
  try {
  const page2 = await page.context().newPage();
  const apps = async (jobId: string) => ((await admin.from("applications").select("id").eq("user_id", testUser.id).eq("job_posting_id", jobId)).data ?? []).length;
  const q = async (jobId: string) => (await admin.from("auto_apply_queue").select("status, credits_spent, application_id").eq("user_id", testUser.id).eq("job_posting_id", jobId).single()).data!;
  const crashed = async () => (await page.getByText(/This page couldn.t load/i).count()) + (await page2.getByText(/This page couldn.t load/i).count());

  // 1. Same item, both Confirm.
  await page.goto("/auto-apply"); await page2.goto("/auto-apply");
  const btn = (p: import("@playwright/test").Page, title: string) => p.locator("li, div", { has: p.getByRole("heading", { name: title }) }).filter({ has: p.getByRole("button", { name: "Confirm and apply" }) }).last().getByRole("button", { name: "Confirm and apply" });
  const answered1 = [actionResponse(page), actionResponse(page2)];
  await Promise.all([btn(page, j1.title).click(), btn(page2, j1.title).click()]);
  await Promise.all(answered1); // both requests have been answered: the database is in its final state
  await Promise.all([settle(page), settle(page2)]);
  await info.attach("1-after-two-confirms", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  expect(await apps(j1.id), "exactly one application for the match").toBe(1);
  const r1 = await q(j1.id);
  expect(r1.status, "the queue row is submitted once").toBe("submitted");
  expect(r1.application_id).not.toBeNull();
  expect.soft(await crashed(), "AUTOAPPLY-RACE-1: the losing tab shows a crash screen").toBe(0);

  // 2. Confirm in one tab, dismiss in the other.
  await page.goto("/auto-apply"); await page2.goto("/auto-apply");
  const dismiss = page2.locator("li, div", { has: page2.getByRole("heading", { name: j2.title }) }).filter({ has: page2.getByRole("button", { name: "Not this one" }) }).last().getByRole("button", { name: "Not this one" });
  const answered2 = [actionResponse(page), actionResponse(page2)];
  await Promise.all([btn(page, j2.title).click(), dismiss.click()]);
  await Promise.all(answered2);
  await Promise.all([settle(page), settle(page2)]);
  const r2 = await q(j2.id);
  const n2 = await apps(j2.id);
  expect(["submitted", "dismissed"], "one decision wins").toContain(r2.status);
  expect(r2.status === "submitted" ? n2 === 1 : n2 === 0, `consistent: status ${r2.status} with ${n2} application(s)`).toBe(true);
  } finally {
    await deletePostingsCascade(admin, jobs.map((j) => j.id));
    await deleteOrgsCascade(admin, [org!.id]);
  }
});
