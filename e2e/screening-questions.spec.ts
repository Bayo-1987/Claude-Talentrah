/**
 * send-327 (0171) / send-344 (0175) — the full screening-question loop,
 * driven through the real UI end to end: an employer adds a free_text
 * question to a posting, a seeker answers it in their own words, and the
 * employer reads back the exact text the seeker typed.
 *
 * This repo has no prior e2e coverage for screening questions at all
 * (checked first — `ls e2e/ | grep -i screen` returned nothing before this
 * file). The integration suite (tests/employer/screening-questions.test.ts)
 * already proves the RPC-level pass/fail computation; what's missing, and
 * what this file exists for, is proof that the three real surfaces —
 * `ScreeningQuestionsEditor`, `ScreeningGateApply`, and the employer
 * applicant list's "View answers" affordance — are actually wired to each
 * other and to the RPCs beneath them.
 *
 * Two independent, genuinely separate signed-in browser contexts (employer,
 * then seeker), same reason mentor-public-name.spec.ts and
 * mentorship-session-counterparty-name.spec.ts use two rather than the
 * shared `authed` fixture, which only ever gives one authenticated context
 * per test.
 *
 * Sabotage-verified before being trusted: temporarily made
 * `submit_screening_answers` insert `null` for `answer_text` regardless of
 * what was sent, confirmed the final assertion (the exact typed text
 * appearing in the employer's "View answers" panel) failed exactly where
 * expected, then restored the real function — see this file's own commit
 * message / PR description for the failure output, not reproduced here.
 */
import { randomUUID } from "node:crypto";
import { test as base, expect } from "@playwright/test";
import { admin, seedBaseResume } from "./fixtures/authed";
import { createServerClient } from "@supabase/ssr";
import { runCleanups } from "../tests/support/teardown";
import { deleteOrgsCascade } from "../tests/support/delete-orgs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

interface SessionCookie {
  name: string;
  value: string;
}

/** Identical to mentor-public-name.spec.ts's own helper — mints a real, verifiable session with no login UI. */
async function mintSessionCookie(email: string): Promise<SessionCookie> {
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const jar = new Map<string, string>();
  const captured: SessionCookie[] = [];
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
  const { error: otpErr } = await ssr.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "magiclink",
  });
  if (otpErr) throw otpErr;
  if (!captured.length) throw new Error("no session cookie produced");
  return captured[0];
}

const WRITTEN_ANSWER =
  "I've spent the last three years building payment infrastructure and I'm drawn to this role specifically because of the merchant-onboarding problem space.";

base.describe("screening questions — full loop", () => {
  let employerUserId: string;
  let seekerUserId: string;
  let orgId: string;

  base.afterEach(async () => {
    await runCleanups(
      [
        "screening e2e organisation",
        async () => {
          if (orgId) await deleteOrgsCascade(admin, [orgId]);
        },
      ],
      [
        "screening e2e users",
        async () => {
          if (employerUserId) await admin.auth.admin.deleteUser(employerUserId).catch(() => {});
          if (seekerUserId) await admin.auth.admin.deleteUser(seekerUserId).catch(() => {});
        },
      ],
    );
  });

  base(
    "employer posts a free_text question, the seeker's written answer is recorded and readable by the employer",
    async ({ browser, baseURL }) => {
      base.setTimeout(60_000);
      const domain = `${randomUUID().slice(0, 12)}.talentrah.test`;
      const employerEmail = `employer-${randomUUID()}@${domain}`;
      const seekerEmail = `seeker-${randomUUID()}@${domain}`;

      const { data: employerUser, error: eErr } = await admin.auth.admin.createUser({
        email: employerEmail,
        email_confirm: true,
      });
      if (eErr) throw eErr;
      employerUserId = employerUser.user.id;

      const { data: seekerUser, error: sErr } = await admin.auth.admin.createUser({
        email: seekerEmail,
        email_confirm: true,
      });
      if (sErr) throw sErr;
      seekerUserId = seekerUser.user.id;
      // A resume-less seeker now sees the "Add a resume to apply" gate
      // instead of ScreeningGateApply at all (see e2e/apply-requires-
      // resume.spec.ts) — correct, but this test is exercising the
      // screening self-assessment flow specifically, so it needs a seeker
      // who actually has a base resume to reach that flow.
      await seedBaseResume(seekerUserId);

      const orgName = `E2E Screening Co ${randomUUID().slice(0, 8)}`;
      const { data: org, error: orgErr } = await admin
        .from("organizations")
        .insert({ name: orgName, created_by: employerUserId, verified: true })
        .select("id")
        .single();
      if (orgErr || !org) throw new Error(`fixture org: ${orgErr?.message}`);
      orgId = org.id;
      const { error: memErr } = await admin
        .from("organization_members")
        .insert({ organization_id: orgId, user_id: employerUserId, role: "owner" });
      if (memErr) throw new Error(`fixture membership: ${memErr.message}`);

      const url = new URL(baseURL ?? "http://localhost:3000");

      // ---- Employer: post a job with one required free_text question ------
      const employerCookie = await mintSessionCookie(employerEmail);
      const employerContext = await browser.newContext();
      await employerContext.addCookies([
        { name: employerCookie.name, value: employerCookie.value, domain: url.hostname, path: "/" },
      ]);
      const employerPage = await employerContext.newPage();

      await employerPage.goto("/employer/jobs/new");
      const jobTitle = `E2E Screening Backend Engineer ${randomUUID().slice(0, 6)}`;
      await employerPage.getByLabel("Job title").fill(jobTitle);
      await employerPage
        .getByLabel("Job description")
        .fill(
          "We are hiring a backend engineer to work on payment APIs. You will design services, write SQL queries, review code, and mentor other engineers.",
        );

      await employerPage.getByRole("button", { name: "+ Add question" }).click();
      await employerPage
        .getByRole("textbox", { name: "Question", exact: true })
        .fill("Why are you interested in this role?");
      await employerPage.getByRole("combobox", { name: "Type", exact: true }).selectOption("free_text");
      // Required stays checked (default) — this is the ONLY question on the
      // posting, so it also proves the required-free-text screening_passed
      // contract from the integration suite, end to end through the UI.
      await expect(employerPage.getByLabel("Required")).toBeChecked();
      await expect(
        employerPage.getByText("Candidates will type a short written answer"),
      ).toBeVisible();

      await employerPage.getByRole("button", { name: "Publish job" }).click();
      await expect(employerPage).toHaveURL(/\/employer\/jobs\?posted=.+$/);
      const jobId = new URL(employerPage.url()).searchParams.get("posted")!;

      // ---- Seeker: apply, answering the written question -------------------
      const seekerCookie = await mintSessionCookie(seekerEmail);
      const seekerContext = await browser.newContext();
      await seekerContext.addCookies([
        { name: seekerCookie.name, value: seekerCookie.value, domain: url.hostname, path: "/" },
      ]);
      const seekerPage = await seekerContext.newPage();

      await seekerPage.goto(`/jobs/${jobId}`);
      await expect(
        seekerPage.getByText("A quick self-assessment before you apply"),
      ).toBeVisible();
      const submitButton = seekerPage.getByRole("button", { name: "Submit application" });
      await expect(submitButton, "the required free_text field should block submission while empty").toBeDisabled();

      await seekerPage.getByLabel(/Why are you interested in this role\?/).fill(WRITTEN_ANSWER);
      await expect(submitButton).toBeEnabled();
      await submitButton.click();
      // The gate is replaced by the normal post-apply page state once
      // applyWithScreeningAction succeeds and router.refresh() re-renders —
      // performInAppApply's own match-scoring step makes this slower than a
      // typical click, hence the longer timeout rather than the default 5s.
      await expect(seekerPage.getByText("A quick self-assessment before you apply")).toHaveCount(0, {
        timeout: 20_000,
      });
      await seekerContext.close();

      // ---- Employer: read the exact written answer back ---------------------
      await employerPage.goto(`/employer/jobs/${jobId}/applicants`);
      const viewAnswers = employerPage.getByRole("button", { name: "View answers" });
      await expect(viewAnswers).toBeVisible();
      // Never a computed pass/fail badge for a job whose ONLY question is
      // free_text and answered — see 0175's own header: a free_text answer
      // makes screening_passed go true by being answered, but this asserts
      // the raw-answer surface specifically, not the badge (already covered
      // by tests/employer/screening-questions.test.ts).
      await viewAnswers.click();
      await expect(employerPage.getByText("Why are you interested in this role?")).toBeVisible();
      await expect(employerPage.getByText(WRITTEN_ANSWER)).toBeVisible();

      await employerContext.close();
    },
  );
});
