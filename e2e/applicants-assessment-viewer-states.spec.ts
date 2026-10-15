/**
 * ASSESSMENT-VIEWER-1 beyond QA's red spec (applicants-assessment-viewer.spec.ts, which covers the owner / another organisation / signed out / View resume): the same-organisation-other-job and
 * made-up-id refusals, the two "nothing to show" states, a hostile and very long answer at 320 px, and a signed-out visitor. Every refusal is paired with the owner reading the answer in the same test.
 */
import { randomUUID } from "node:crypto";
import { test, expect, admin } from "./fixtures/authed";
import { deleteOrgsCascade, deletePostingsCascade } from "../tests/support/delete-orgs";

const PATH = (jobId: string, applicationId: string) => `/employer/jobs/${jobId}/applicants/${applicationId}/assessment`;
const HOSTILE = `<script>alert(1)</script><img src=x onerror=alert(1)><script>window.__pwned = true</script><b>bold</b> & ${"Z".repeat(5000)}`;
const NOT_FOUND = /could not be found|not found|404/i;

test("the assessment viewer: other job, made-up id, no response, no assessment, hostile long text, headers, signed out", async ({ authedPage: page, testUser, browser }, info) => {
  test.setTimeout(180_000);
  const tag = randomUUID().slice(0, 6);
  const { data: org } = await admin.from("organizations").insert({ name: `E2E Employer Co AVS${tag}`, created_by: testUser.id, verified: true }).select("id").single();
  await admin.from("organization_members").insert({ organization_id: org!.id, user_id: testUser.id, role: "owner" });
  const mkJob = async (title: string) => {
    const { data, error } = await admin.from("job_postings").insert({ source_type: "internal", organization_id: org!.id, company_name: "QA Co", title: `${title} ${tag}`, description: "x".repeat(120), location: "Lagos, Nigeria", work_type: "remote", employment_type: "full_time", structured_jd: { skills: ["sql"] }, status: "open", dedup_fingerprint: randomUUID() }).select("id").single();
    if (error || !data) throw new Error(`job: ${error?.message}`);
    return data.id;
  };
  const jobA = await mkJob("QA Viewer A");
  const jobB = await mkJob("QA Viewer B");
  const jobNone = await mkJob("QA Viewer no assessment");
  for (const j of [jobA, jobB]) await admin.from("job_posting_assessments").insert({ job_posting_id: j, organization_id: org!.id, title: "Take-home", instructions: "Do it.", required: false, created_by: testUser.id });
  const users = await Promise.all([1, 2, 3, 4].map(async (n) => (await admin.auth.admin.createUser({ email: `qa-avs-${n}-${tag}@${tag}.talentrah.test`, email_confirm: true })).data.user!));
  const apply = async (userId: string, jobId: string) => {
    const { data, error } = await admin.from("applications").insert({ user_id: userId, job_posting_id: jobId, stage: "applied", source: "manual", applied_at: new Date().toISOString() }).select("id").single();
    if (error || !data) throw new Error(`application: ${error?.message}`);
    return data.id;
  };
  const appHostile = await apply(users[0].id, jobA);
  const appNoAnswer = await apply(users[1].id, jobA);
  const appOtherJob = await apply(users[2].id, jobB);
  const appNoAssessment = await apply(users[3].id, jobNone);
  await admin.from("application_assessment_submissions").insert({ application_id: appHostile, job_posting_id: jobA, organization_id: org!.id, response_text: HOSTILE });
  await admin.from("application_assessment_submissions").insert({ application_id: appOtherJob, job_posting_id: jobB, organization_id: org!.id, response_text: "job B's own answer" });
  const read = async (path: string) => {
    const resp = await page.goto(path);
    await page.waitForLoadState("networkidle");
    return { status: resp?.status() ?? 0, text: (await page.locator("body").innerText()).replace(/\s+/g, " ") };
  };
  try {
    // The owner's success: hostile text shows as TEXT, nothing runs, and nothing scrolls sideways at 390 px, 1280 px (and 320 px).
    const dialogs: string[] = [];
    page.on("dialog", (d) => { dialogs.push(d.message()); void d.dismiss(); });
    const owner = await read(PATH(jobA, appHostile));
    expect(owner.status, "the owner's page is a 200").toBe(200);
    expect(owner.text, "script shows as visible text").toContain("<script>alert(1)</script>");
    expect(owner.text, "img shows as visible text").toContain("<img src=x onerror=alert(1)>");
    expect(owner.text).toContain("<b>bold</b> &");
    expect(await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned), "the script in the answer did not run").toBeUndefined();
    expect(dialogs, "no alert(1) ran").toEqual([]);
    expect(await page.locator('[data-testid="assessment-answer"] script, [data-testid="assessment-answer"] img').count(), "no script or img element was made from the answer").toBe(0);
    for (const width of [390, 1280, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await page.waitForTimeout(150);
      const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, body: document.body.scrollWidth }));
      expect(o.scroll, `no horizontal page scroll at ${width} px (page ${o.scroll} wide in ${o.client})`).toBeLessThanOrEqual(o.client);
      expect(o.body, `body no wider than the screen at ${width} px`).toBeLessThanOrEqual(o.client);
      const answerBox = await page.locator('[data-testid="assessment-answer"]').boundingBox();
      expect(answerBox && answerBox.x + answerBox.width, `the answer stays inside the screen at ${width} px`).toBeLessThanOrEqual(width + 1);
    }
    await page.setViewportSize({ width: 1280, height: 800 });

    // PRIVATE: noindex and no-store on the page response.
    const ownerResponse = await page.goto(PATH(jobA, appHostile));
    const h = ownerResponse!.headers();
    expect(h["x-robots-tag"], "X-Robots-Tag").toMatch(/noindex/);
    expect(h["cache-control"], "Cache-Control").toContain("private");
    expect(h["cache-control"], "Cache-Control").toContain("no-store");
    expect(await page.locator('meta[name="robots"]').getAttribute("content"), "robots meta").toMatch(/noindex/);

    // Same organisation, OTHER job / a made-up id: not found, with the owner's success right beside them.
    expect((await read(PATH(jobB, appOtherJob))).text, "owner reads job B's own answer").toContain("job B's own answer");
    const wrongJob = await read(PATH(jobA, appOtherJob));
    expect(wrongJob.text).not.toContain("job B's own answer");
    expect(wrongJob.status === 404 || NOT_FOUND.test(wrongJob.text), "another job's application is a not-found page").toBe(true);
    const madeUp = await read(PATH(jobA, randomUUID()));
    expect(madeUp.status === 404 || NOT_FOUND.test(madeUp.text), "a made-up application id is a not-found page").toBe(true);
    const madeUpJob = await read(PATH(randomUUID(), appHostile));
    expect(madeUpJob.status === 404 || NOT_FOUND.test(madeUpJob.text), "a made-up job id is a not-found page").toBe(true);

    // Nothing to show: a plain message for the OWNER, with a 200: not an error, not a blank page, not a 404.
    const noAnswer = await read(PATH(jobA, appNoAnswer));
    expect(noAnswer.status, "no response: a 200 page").toBe(200);
    expect(noAnswer.text).toContain("has not submitted an assessment response yet");
    expect(noAnswer.text, "no response: not the not-found page").not.toMatch(NOT_FOUND);
    expect(noAnswer.text.length).toBeGreaterThan(80);
    await page.screenshot({ fullPage: true, path: info.outputPath("no-response-yet.png") });
    await info.attach("no-response-yet", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    const noAssessment = await read(PATH(jobNone, appNoAssessment));
    expect(noAssessment.status, "no assessment: a 200 page").toBe(200);
    expect(noAssessment.text).toContain("This job has no assessment");
    expect(noAssessment.text, "no assessment: not the not-found page").not.toMatch(NOT_FOUND);
    expect(noAssessment.text.length).toBeGreaterThan(80);
    await page.screenshot({ fullPage: true, path: info.outputPath("job-has-no-assessment.png") });
    await info.attach("job-has-no-assessment", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

    // Signed out: sent to log in, never shown the answer. A real application id and a made-up one get the SAME status and the same location (the only difference is the requested path echoed back in redirectTo).
    const anon = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000" });
    const hit = async (path: string) => {
      const r = await anon.request.get(path, { maxRedirects: 0 });
      return { status: r.status(), location: r.headers()["location"] ?? "", cache: r.headers()["cache-control"] ?? "", robots: r.headers()["x-robots-tag"] ?? "" };
    };
    const realId = await hit(PATH(jobA, appHostile));
    const madeUpId = await hit(PATH(jobA, randomUUID()));
    expect(realId.status, "signed out is a redirect").toBeGreaterThanOrEqual(300);
    expect(realId.status).toBeLessThan(400);
    expect(madeUpId.status, "the same status for a real and a made-up application id").toBe(realId.status);
    const generic = (location: string) => location.replace(/applicants%2F[0-9a-f-]{36}%2Fassessment/i, "applicants%2F{id}%2Fassessment");
    expect(new URL(realId.location, "http://x").pathname, "to /login").toBe("/login");
    expect(new URL(madeUpId.location, "http://x").pathname, "to /login").toBe("/login");
    expect(generic(madeUpId.location), "the same location once the echoed id is set aside").toBe(generic(realId.location));
    expect(decodeURIComponent(new URL(realId.location, "http://x").searchParams.get("redirectTo") ?? ""), "redirectTo is only the path that was asked for").toBe(PATH(jobA, appHostile));
    expect(realId.robots + madeUpId.robots, "the redirect is noindex too").toMatch(/noindex.*noindex/);
    const anonPage = await anon.newPage();
    await anonPage.goto(PATH(jobA, appHostile));
    await anonPage.waitForLoadState("networkidle");
    expect(new URL(anonPage.url()).pathname, "a signed-out visitor lands on /login").toBe("/login");
    expect(await anonPage.locator("body").innerText()).not.toContain("__pwned");
    await anon.close();
  } finally {
    await admin.from("applications").delete().in("id", [appHostile, appNoAnswer, appOtherJob, appNoAssessment]);
    await deletePostingsCascade(admin, [jobA, jobB, jobNone]);
    await deleteOrgsCascade(admin, [org!.id]);
    for (const u of users) await admin.auth.admin.deleteUser(u.id);
  }
});
