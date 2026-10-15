/**
 * DRAFT RED SPEC (QA, 10 Oct) for the applicants-page work item "View assessment response opens in the page (like View resume); Download PDF secondary; only the job's own org can open it, other orgs get 404".
 * Builders start from this: it FAILS on current main on purpose (the in-page viewer does not exist yet). Local stack, minted sessions, throwaway orgs/users removed afterwards.
 *
 * ASSUMED SHAPE (align the two constants below with the real build; do not weaken the assertions):
 *   - the applicant card's "View assessment response" becomes a LINK that navigates to ASSESSMENT_PATH(job, application), the way "View resume" navigates to .../resume;
 *   - that page shows the candidate's written answer and link IN THE PAGE (not only a download), and offers "Download PDF" as a secondary control;
 *   - a signed-in employer of ANOTHER organisation gets a 404 there, and so does a signed-out visitor; the owning organisation gets a 200.
 * Cases: A the owner reads the answer in the page (RED now); B another org / signed out get 404 while the owner gets 200 (RED now: paired with the owner's 200 so it cannot pass by "everything is a 404");
 * C guard that must stay green: View resume still works for the owner and is 404 for the other org.
 */
import { randomUUID } from "node:crypto";
import { test, expect, admin, mintSecondSession } from "./fixtures/authed";
import { deleteOrgsCascade, deletePostingsCascade } from "../tests/support/delete-orgs";

const ASSESSMENT_PATH = (jobId: string, applicationId: string) => `/employer/jobs/${jobId}/applicants/${applicationId}/assessment`;
const RESUME_PATH = (jobId: string, applicationId: string) => `/employer/jobs/${jobId}/applicants/${applicationId}/resume`;
const ANSWER = "QA assessment answer: SELECT customer_id, SUM(amount) FROM orders GROUP BY 1 LIMIT 3;";

test("applicants: the assessment response opens in the page for the owning org only; View resume still works", async ({ authedPage: page, testUser, browser }, info) => {
  test.setTimeout(150_000);
  const tag = randomUUID().slice(0, 6);
  const { data: org } = await admin.from("organizations").insert({ name: `E2E Employer Co AV${tag}`, created_by: testUser.id, verified: true }).select("id").single();
  await admin.from("organization_members").insert({ organization_id: org!.id, user_id: testUser.id, role: "owner" });
  const { data: job, error: jobErr } = await admin.from("job_postings").insert({ source_type: "internal", organization_id: org!.id, company_name: "QA Co", title: `QA Assessment Role ${tag}`, description: "x".repeat(120), location: "Lagos, Nigeria", work_type: "remote", employment_type: "full_time", structured_jd: { skills: ["sql"] }, status: "open", dedup_fingerprint: randomUUID() }).select("id").single();
  if (jobErr || !job) throw new Error(`fixture job: ${jobErr?.message}`);
  await admin.from("job_posting_assessments").insert({ job_posting_id: job.id, organization_id: org!.id, title: "Take-home SQL exercise", instructions: "Write a query.", required: false, created_by: testUser.id });
  const candidate = (await admin.auth.admin.createUser({ email: `qa-cand-${tag}@${tag}.talentrah.test`, email_confirm: true })).data.user!;
  await admin.from("profiles").update({ first_name: "QACandidate", last_name: tag }).eq("id", candidate.id);
  const content = { contact: { name: `QACandidate ${tag}` }, summary: "Backend engineer.", experience: [], education: [], skills: ["sql"], projects: [], certifications: [] };
  const { data: resume } = await admin.from("resumes").insert({ user_id: candidate.id, title: "QA candidate resume", is_base: true, source: "builder", structured_content: content }).select("id").single();
  const { data: app, error: appErr } = await admin.from("applications").insert({ user_id: candidate.id, job_posting_id: job.id, resume_id: resume!.id, resume_snapshot: content, stage: "applied", source: "manual", applied_at: new Date().toISOString() }).select("id").single();
  if (appErr || !app) throw new Error(`fixture application: ${appErr?.message}`);
  await admin.from("application_assessment_submissions").insert({ application_id: app.id, job_posting_id: job.id, organization_id: org!.id, response_text: ANSWER });
  // A second employer, organisation B.
  const other = (await admin.auth.admin.createUser({ email: `qa-other-emp-${tag}@${tag}.talentrah.test`, email_confirm: true })).data.user!;
  const { data: orgB } = await admin.from("organizations").insert({ name: `E2E Employer Co AV-B${tag}`, created_by: other.id, verified: true }).select("id").single();
  await admin.from("organization_members").insert({ organization_id: orgB!.id, user_id: other.id, role: "owner" });
  const otherCookie = await mintSecondSession({ id: other.id, email: other.email! });
  const otherCtx = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000" });
  await otherCtx.addCookies([{ name: otherCookie.name, value: otherCookie.value, domain: "localhost", path: "/", httpOnly: false, secure: false, sameSite: "Lax" }]);
  /** What a person would see: these pages stream (a loading skeleton first), so the HTTP status can read 200 even for a not-found; read the rendered page. */
  const read = async (ctx: typeof otherCtx, path: string) => {
    const p = await ctx.newPage();
    const resp = await p.goto(path);
    await p.waitForLoadState("networkidle");
    const text = (await p.locator("body").innerText()).replace(/\s+/g, " ");
    await p.close();
    return { status: resp?.status() ?? 0, text };
  };
  const NOT_FOUND = /could not be found|not found|404/i;
  try {
    // C (guard): View resume, owner sees it, the other org gets the not-found page and none of the candidate's data.
    const ownerResume = await read(page.context(), RESUME_PATH(job.id, app.id));
    expect(ownerResume.text, "owner can open View resume").toContain("Backend engineer");
    const otherResume = await read(otherCtx, RESUME_PATH(job.id, app.id));
    expect(otherResume.text, "another organisation sees no resume content").not.toContain("Backend engineer");
    expect(otherResume.status === 404 || NOT_FOUND.test(otherResume.text), `another organisation gets a not-found page (status ${otherResume.status})`).toBe(true);

    // A: the owner reads the answer in the page, through the card's link.
    await page.goto(`/employer/jobs/${job.id}/applicants`);
    const view = page.getByRole("link", { name: "View assessment response" });
    await expect(view, "RED until built: 'View assessment response' is a link to its own page, like View resume").toBeVisible({ timeout: 15_000 });
    await view.click();
    await page.waitForURL((u) => u.pathname === ASSESSMENT_PATH(job.id, app.id), { timeout: 30_000 });
    await expect(page.getByText(ANSWER), "the written answer is shown in the page").toBeVisible();
    await expect(page.getByRole("button", { name: /Save as PDF/i }).or(page.getByRole("link", { name: /Save as PDF/i })).first(), "Save as PDF is offered as the secondary control").toBeVisible();
    await info.attach("owner-view", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

    // B: access control, paired with the owner's success.
    const ownerView = await read(page.context(), ASSESSMENT_PATH(job.id, app.id));
    expect(ownerView.text, "the owning organisation reads the answer").toContain("QA assessment answer");
    const otherView = await read(otherCtx, ASSESSMENT_PATH(job.id, app.id));
    expect(otherView.text, "another organisation never sees the answer").not.toContain("QA assessment answer");
    expect(otherView.status === 404 || NOT_FOUND.test(otherView.text), `another organisation gets a not-found page (status ${otherView.status})`).toBe(true);
    const anon = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000" });
    const anonView = await read(anon, ASSESSMENT_PATH(job.id, app.id));
    expect(anonView.text, "a signed-out visitor never sees the answer").not.toContain("QA assessment answer");
    await anon.close();
  } finally {
    await otherCtx.close();
    await admin.from("applications").delete().eq("id", app.id);
    await deletePostingsCascade(admin, [job.id]);
    await deleteOrgsCascade(admin, [org!.id, orgB!.id]);
    for (const id of [candidate.id, other.id]) await admin.auth.admin.deleteUser(id);
  }
});
