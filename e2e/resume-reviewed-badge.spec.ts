/**
 * VERIFY-1 Phase 0a — the resume-reviewed badge, in the built app, where employers see it: the Talent Directory list, a candidate's page and the applicant list,
 * at a desktop width (1440) and a phone width (390).
 *
 * Throwaway fixtures, all created and removed here (nothing depends on the seeded demo data): an employer with a verified organisation and an ACTIVE directory
 * subscription, two directory candidates (one reviewed by Farah, so it has a stored score; one reviewed by a mentor, so it has none), and two applications to one
 * job posting. The unit and render tests (tests/talent-directory/review-badge-surfaces.test.tsx) cover every branch; this proves the screens a person actually
 * uses show it, can open "What this means", and do not overflow a phone.
 *
 * What it asserts the employer never sees: a score, "/100", or the word "verified". The scores are real in the database (87 for the AI one) so the absence is not
 * because there was nothing to leave out.
 */
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { admin } from "./fixtures/authed";
import { runCleanups } from "../tests/support/teardown";
import { deleteOrgsCascade } from "../tests/support/delete-orgs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function mintSessionCookie(email: string): Promise<{ name: string; value: string }> {
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const jar = new Map<string, string>();
  const captured: Array<{ name: string; value: string }> = [];
  const ssr = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (list) => {
        for (const c of list) {
          jar.set(c.name, c.value);
          captured.push({ name: c.name, value: c.value });
        }
      },
    },
  });
  const { error: otpErr } = await ssr.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (otpErr) throw otpErr;
  if (!captured.length) throw new Error("no session cookie produced");
  return captured[0];
}

const AI_REVIEWED_AT = "2026-10-05T09:30:00Z";
const MENTOR_REVIEWED_AT = "2026-10-12T10:00:00Z";
const tag = randomUUID().slice(0, 6);
const AI_NAME = { first: `Aiko${tag}`, last: "Reviewed" };
const MENTOR_NAME = { first: `Mento${tag}`, last: "Reviewed" };

const fx: {
  employerEmail: string;
  employerId: string;
  orgId: string;
  planId: string | null;
  createdPlan: boolean;
  aiId: string;
  mentorId: string;
  jobId: string;
} = { employerEmail: "", employerId: "", orgId: "", planId: null, createdPlan: false, aiId: "", mentorId: "", jobId: "" };

async function createCandidate(first: string, last: string, score: number | null, reviewedAt: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({ email: `cand-${randomUUID()}@talentrah.test`, email_confirm: true });
  if (error) throw error;
  const { error: profileError } = await admin
    .from("profiles")
    .update({
      first_name: first,
      last_name: last,
      country: "Nigeria",
      talent_verification_status: "verified",
      talent_verification_score: score,
      talent_verified_at: reviewedAt,
      talent_directory_opt_in: true,
      talent_available_for_hire: true,
      talent_remote_ready: true,
    })
    .eq("id", data.user.id);
  if (profileError) throw new Error(`candidate profile: ${profileError.message}`);
  // the type on the badge is the one recorded on the candidate's passed review (0234), so write that review: a score means Farah graded it, none means a mentor did
  const { error: reviewError } = await admin
    .from("talent_verifications")
    .insert({ user_id: data.user.id, status: "verified", review_type: score === null ? "human" : "ai", ai_score: score, requested_at: reviewedAt, decided_at: reviewedAt });
  if (reviewError) throw new Error(`candidate review: ${reviewError.message}`);
  return data.user.id;
}

async function signedIn(page: Page, baseURL: string | undefined) {
  const cookie = await mintSessionCookie(fx.employerEmail);
  const url = new URL(baseURL ?? "http://localhost:3000");
  await page.context().addCookies([{ name: cookie.name, value: cookie.value, domain: url.hostname, path: "/" }]);
}

test.describe("the resume-reviewed badge", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    fx.employerEmail = `employer-${randomUUID()}@${randomUUID().slice(0, 10)}.talentrah.test`;
    const { data: employer, error: employerError } = await admin.auth.admin.createUser({ email: fx.employerEmail, email_confirm: true });
    if (employerError) throw employerError;
    fx.employerId = employer.user.id;

    const { data: org, error: orgError } = await admin
      .from("organizations")
      .insert({ name: `E2E Employer Co badge ${tag}`, created_by: fx.employerId, verified: true })
      .select("id")
      .single();
    if (orgError || !org) throw new Error(`fixture org: ${orgError?.message}`);
    fx.orgId = org.id;
    const { error: memberError } = await admin.from("organization_members").insert({ organization_id: fx.orgId, user_id: fx.employerId, role: "owner" });
    if (memberError) throw new Error(`fixture membership: ${memberError.message}`);

    const { data: existingPlan } = await admin.from("talent_directory_plans").select("id").limit(1).maybeSingle();
    if (existingPlan) fx.planId = existingPlan.id;
    else {
      const { data: plan, error: planError } = await admin.from("talent_directory_plans").insert({ name: `E2E plan ${tag}`, price_ngn: 1, duration_days: 30, is_active: true }).select("id").single();
      if (planError || !plan) throw new Error(`fixture plan: ${planError?.message}`);
      fx.planId = plan.id;
      fx.createdPlan = true;
    }
    const expires = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const { error: subError } = await admin.from("talent_directory_subscriptions").insert({ organization_id: fx.orgId, plan_id: fx.planId!, status: "active", expires_at: expires });
    if (subError) throw new Error(`fixture subscription: ${subError.message}`);

    fx.aiId = await createCandidate(AI_NAME.first, AI_NAME.last, 87, AI_REVIEWED_AT);
    fx.mentorId = await createCandidate(MENTOR_NAME.first, MENTOR_NAME.last, null, MENTOR_REVIEWED_AT);

    // The employer posts a job through the real form (the same way e2e/screening-questions.spec.ts does), then both candidates have applied to it.
    const context = await browser.newContext();
    const page = await context.newPage();
    await signedIn(page, baseURL);
    await page.goto("/employer/jobs/new");
    await page.getByLabel("Job title").fill(`E2E Badge Backend Engineer ${tag}`);
    await page.getByLabel("Job description").fill("We are hiring a backend engineer to work on payment APIs. You will design services, write SQL queries, review code, and mentor other engineers.");
    await page.getByRole("button", { name: "Publish job" }).click();
    await expect(page).toHaveURL(/\/employer\/jobs\?posted=.+$/);
    fx.jobId = new URL(page.url()).searchParams.get("posted")!;
    await context.close();

    for (const userId of [fx.aiId, fx.mentorId]) {
      const { error: appError } = await admin
        .from("applications")
        .insert({ user_id: userId, job_posting_id: fx.jobId, stage: "applied", source: "internal_apply", applied_at: new Date().toISOString() });
      if (appError) throw new Error(`fixture application: ${appError.message}`);
    }
  });

  test.afterAll(async () => {
    await runCleanups(
      ["badge e2e subscription", async () => void (await admin.from("talent_directory_subscriptions").delete().eq("organization_id", fx.orgId))],
      ["badge e2e applications", async () => void (await admin.from("applications").delete().in("user_id", [fx.aiId, fx.mentorId]))],
      ["badge e2e organisation", async () => { if (fx.orgId) await deleteOrgsCascade(admin, [fx.orgId]); }],
      ["badge e2e plan", async () => { if (fx.createdPlan && fx.planId) await admin.from("talent_directory_plans").delete().eq("id", fx.planId); }],
      ["badge e2e users", async () => { for (const id of [fx.employerId, fx.aiId, fx.mentorId]) if (id) await admin.auth.admin.deleteUser(id).catch(() => {}); }],
    );
  });

  for (const viewport of [
    { name: "desktop 1440", width: 1440, height: 900 },
    { name: "phone 390", width: 390, height: 844 },
  ]) {
    test.describe(viewport.name, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });

      test("the directory list shows each candidate's badge and date, opens 'What this means', and shows no score", async ({ page, baseURL }) => {
        await signedIn(page, baseURL);
        await page.goto("/employer/talent-directory");
        await expect(page.getByRole("heading", { name: "Search candidates with a reviewed resume." })).toBeVisible();

        const aiCard = page.locator("li", { hasText: `${AI_NAME.first} ${AI_NAME.last}` });
        const mentorCard = page.locator("li", { hasText: `${MENTOR_NAME.first} ${MENTOR_NAME.last}` });
        await expect(aiCard.getByTestId("resume-reviewed-badge")).toHaveText("Resume reviewed by Farah (AI) · 5 Oct 2026");
        await expect(mentorCard.getByTestId("resume-reviewed-badge")).toHaveText("Resume reviewed by a Talentrah mentor · 12 Oct 2026");

        const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
        expect(body).not.toMatch(/\b87\b|\/\s*100|verified/i);

        // "What this means" opens from the badge without leaving the page, and is big enough to hit.
        const summary = aiCard.getByText("What this means");
        const box = await summary.boundingBox();
        expect(box!.height, "the control is at least 32px tall").toBeGreaterThanOrEqual(32);
        await summary.click();
        await expect(aiCard.getByText("We checked that the resume is complete, specific and consistent. We did not check identity, employment history or skills.")).toBeVisible();
        await expect(aiCard.getByRole("link", { name: "How we review" })).toHaveAttribute("href", "/how-we-review-resumes?from=%2Femployer%2Ftalent-directory");
        await expect(page).toHaveURL(/\/employer\/talent-directory$/);

        // The title is still the way into the candidate.
        await aiCard.getByRole("link", { name: `${AI_NAME.first} ${AI_NAME.last}` }).click();
        await expect(page).toHaveURL(new RegExp(`/employer/talent-directory/${fx.aiId}$`));

        await page.goto("/employer/talent-directory");
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, "no horizontal scroll").toBeLessThanOrEqual(0);
      });

      test("by keyboard: Tab goes from the candidate's name to 'What this means', Enter opens it, and the next Tab reaches 'How we review'", async ({ page, baseURL }) => {
        await signedIn(page, baseURL);
        await page.goto("/employer/talent-directory");
        const card = page.locator("li", { hasText: `${AI_NAME.first} ${AI_NAME.last}` });
        await card.getByRole("link", { name: `${AI_NAME.first} ${AI_NAME.last}` }).focus();
        await page.keyboard.press("Tab");
        await expect(card.locator("summary")).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(card.locator("details")).toHaveAttribute("open", "");
        await page.keyboard.press("Tab");
        await expect(card.getByRole("link", { name: "How we review" })).toBeFocused();
        await expect(page).toHaveURL(/\/employer\/talent-directory$/);
      });

      test("a candidate's page shows the badge with its date, for both kinds of review", async ({ page, baseURL }) => {
        await signedIn(page, baseURL);
        await page.goto(`/employer/talent-directory/${fx.aiId}`);
        await expect(page.getByTestId("resume-reviewed-badge")).toHaveText("Resume reviewed by Farah (AI) · 5 Oct 2026");
        await page.goto(`/employer/talent-directory/${fx.mentorId}`);
        await expect(page.getByTestId("resume-reviewed-badge")).toHaveText("Resume reviewed by a Talentrah mentor · 12 Oct 2026");
        const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
        expect(body).not.toMatch(/\b87\b|\/\s*100|verified/i);
      });

      test("the applicant list shows who reviewed each resume and when, with no score", async ({ page, baseURL }) => {
        await signedIn(page, baseURL);
        await page.goto(`/employer/jobs/${fx.jobId}/applicants`);
        const badges = page.getByTestId("resume-reviewed-badge");
        await expect(badges).toHaveCount(2);
        await expect(page.getByText("Resume reviewed by Farah (AI) · 5 Oct 2026", { exact: true })).toBeVisible();
        await expect(page.getByText("Resume reviewed by a Talentrah mentor · 12 Oct 2026", { exact: true })).toBeVisible();
        const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
        expect(body).not.toMatch(/\b87\b|\/\s*100|verified/i);

        const summary = page.getByText("What this means").first();
        await summary.click();
        await expect(page.getByRole("link", { name: "How we review" }).first()).toHaveAttribute("href", "/how-we-review-resumes?from=%2Femployer%2Fjobs");
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, "no horizontal scroll").toBeLessThanOrEqual(0);
      });
    });
  }

  test("HWR-1: a signed-in employer opens How we review from the directory, clicks Back, and is on the directory, still signed in", async ({ page, baseURL }) => {
    await signedIn(page, baseURL);
    await page.goto("/employer/talent-directory");
    const aiCard = page.locator("li", { hasText: `${AI_NAME.first} ${AI_NAME.last}` });
    await aiCard.getByText("What this means").click();
    await aiCard.getByRole("link", { name: "How we review" }).click();
    await expect(page).toHaveURL(/\/how-we-review-resumes\?from=%2Femployer%2Ftalent-directory$/);
    await expect(page.getByRole("heading", { name: "How we review resumes" })).toBeVisible();
    const back = page.getByRole("link", { name: "← Back to Talent Directory" });
    await expect(back).toBeVisible();
    await expect(back).toHaveAttribute("href", "/employer/talent-directory");
    await back.click();
    await expect(page).toHaveURL(/\/employer\/talent-directory$/);
    // Still signed in: the directory itself, not the login page.
    await expect(page.getByRole("heading", { name: "Search candidates with a reviewed resume." })).toBeVisible();
  });

  test("HWR-1: from the candidate's page and the applicant list, Back goes to the directory and to Jobs Posted (no id in the URL)", async ({ page, baseURL }) => {
    await signedIn(page, baseURL);
    await page.goto(`/employer/talent-directory/${fx.aiId}`);
    await page.getByText("What this means").click();
    await page.getByRole("link", { name: "How we review" }).click();
    await expect(page).toHaveURL(/\/how-we-review-resumes\?from=%2Femployer%2Ftalent-directory$/);
    expect(page.url()).not.toContain(fx.aiId);
    await page.getByRole("link", { name: "← Back to Talent Directory" }).click();
    await expect(page).toHaveURL(/\/employer\/talent-directory$/);

    await page.goto(`/employer/jobs/${fx.jobId}/applicants`);
    await page.getByText("What this means").first().click();
    await page.getByRole("link", { name: "How we review" }).first().click();
    await expect(page).toHaveURL(/\/how-we-review-resumes\?from=%2Femployer%2Fjobs$/);
    expect(page.url()).not.toContain(fx.jobId);
    await page.getByRole("link", { name: "← Back to Jobs Posted" }).click();
    await expect(page).toHaveURL(/\/employer\/jobs$/);
  });

  test("HWR-1: with no from, or a hostile one, the page shows no Back link", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    for (const query of ["", "?from=//evil.example", "?from=http://evil.example", "?from=javascript:alert(1)", `?from=/employer/talent-directory/${fx.aiId}`]) {
      await page.goto(`/how-we-review-resumes${query}`);
      await expect(page.getByRole("heading", { name: "How we review resumes" })).toBeVisible();
      await page.waitForTimeout(500);
      await expect(page.getByRole("link", { name: /Back to/ }), `a Back link appeared for ${query || "no from"}`).toHaveCount(0);
    }
    await context.close();
  });

  test("the 'How we review' page reads signed out", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const response = await page.goto("/how-we-review-resumes");
    expect(response?.status()).toBe(200);
    expect(page.url()).toContain("/how-we-review-resumes");
    await expect(page.getByRole("heading", { name: "How we review resumes" })).toBeVisible();
    await expect(page.getByText("We don’t check who the person is.")).toBeVisible();
    await context.close();
  });
});
