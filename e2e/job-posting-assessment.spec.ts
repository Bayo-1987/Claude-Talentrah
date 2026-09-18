/**
 * send-346 v2 (migration 0177) — the full assessment-attachment loop,
 * driven through the real UI end to end: an employer attaches an
 * assessment (with a link, plus a screening question on the SAME
 * posting — this exercises the "both present" combination the feature's
 * own spec calls out by name), a seeker answers the screening question
 * AND uploads a file as their assessment response, and the employer reads
 * back both — including a WORKING, correctly-scoped link to the
 * candidate's actual file, not just a database row.
 *
 * Two independent, genuinely separate signed-in browser contexts, same
 * pattern e2e/screening-questions.spec.ts already establishes for exactly
 * this reason — the shared `authed` fixture only ever gives one
 * authenticated context per test.
 *
 * Sabotage-verified at the APPLICATION layer: temporarily made
 * getApplicationAssessmentSubmissionAction always return a null
 * responseFileUrl regardless of what's on file, confirmed this test's own
 * "View response file" link assertion failed exactly where expected, then
 * restored the real signed-URL logic and re-confirmed green. (A live
 * mutation of the shared dev database's own can_access_assessment_
 * submission function — the more direct sabotage target for the storage
 * policy itself — was attempted first and correctly refused as a
 * shared-resource risk; that policy's four read combinations are instead
 * pinned directly, and independently sabotage-worthy in their own right,
 * by tests/employer/assessment-storage-rls.test.ts.)
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

/** Identical to screening-questions.spec.ts's own helper — mints a real, verifiable session with no login UI. */
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
  const { error: otpErr } = await ssr.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (otpErr) throw otpErr;
  if (!captured.length) throw new Error("no session cookie produced");
  return captured[0];
}

base.describe("job posting assessment — full loop", () => {
  let employerUserId: string;
  let seekerUserId: string;
  let orgId: string;

  base.afterEach(async () => {
    await runCleanups(
      [
        "assessment e2e organisation",
        async () => {
          if (orgId) await deleteOrgsCascade(admin, [orgId]);
        },
      ],
      [
        "assessment e2e users",
        async () => {
          if (employerUserId) await admin.auth.admin.deleteUser(employerUserId).catch(() => {});
          if (seekerUserId) await admin.auth.admin.deleteUser(seekerUserId).catch(() => {});
        },
      ],
    );
  });

  base(
    "employer attaches an assessment + a screening question; the seeker answers both; the employer reads back a working file link",
    async ({ browser, baseURL }) => {
      base.setTimeout(90_000);
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
      await seedBaseResume(seekerUserId);

      const orgName = `E2E Assessment Co ${randomUUID().slice(0, 8)}`;
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

      // ---- Employer: post a job with a screening question AND an assessment
      const employerCookie = await mintSessionCookie(employerEmail);
      const employerContext = await browser.newContext();
      await employerContext.addCookies([
        { name: employerCookie.name, value: employerCookie.value, domain: url.hostname, path: "/" },
      ]);
      const employerPage = await employerContext.newPage();

      await employerPage.goto("/employer/jobs/new");
      const jobTitle = `E2E Assessment Backend Engineer ${randomUUID().slice(0, 6)}`;
      await employerPage.getByLabel("Job title").fill(jobTitle);
      await employerPage
        .getByLabel("Job description")
        .fill(
          "We are hiring a backend engineer to work on payment APIs. You will design services, write SQL queries, review code, and mentor other engineers.",
        );

      await employerPage.getByRole("button", { name: "+ Add question" }).click();
      await employerPage
        .getByRole("textbox", { name: "Question", exact: true })
        .fill("Years of backend experience?");
      await employerPage.getByRole("combobox", { name: "Type", exact: true }).selectOption("min_number");
      await employerPage.getByLabel("Minimum to pass").fill("1");

      await employerPage.getByLabel("Attach an assessment (optional)").check();
      await employerPage.getByLabel("Title", { exact: true }).fill("Take-home SQL exercise");
      await employerPage
        .getByLabel("Instructions", { exact: true })
        .fill("Write a query that finds the top 3 customers by spend.");
      await employerPage
        .getByLabel(/Link to the exercise/)
        .fill("https://example.com/sql-exercise");
      await expect(employerPage.getByLabel("Required to apply")).toBeChecked();

      await employerPage.getByRole("button", { name: "Publish job" }).click();
      await expect(employerPage).toHaveURL(/\/employer\/jobs\?posted=.+$/);
      const jobId = new URL(employerPage.url()).searchParams.get("posted")!;

      // ---- Seeker: apply, answering the screening question AND uploading
      //      a file as the assessment response ----------------------------
      const seekerCookie = await mintSessionCookie(seekerEmail);
      const seekerContext = await browser.newContext();
      await seekerContext.addCookies([
        { name: seekerCookie.name, value: seekerCookie.value, domain: url.hostname, path: "/" },
      ]);
      const seekerPage = await seekerContext.newPage();

      await seekerPage.goto(`/jobs/${jobId}`);
      await expect(seekerPage.getByText("Take-home SQL exercise")).toBeVisible();
      await expect(
        seekerPage.getByText("Write a query that finds the top 3 customers by spend."),
      ).toBeVisible();
      await expect(seekerPage.getByRole("link", { name: "Open the exercise" })).toHaveAttribute(
        "href",
        "https://example.com/sql-exercise",
      );

      const submitButton = seekerPage.getByRole("button", { name: "Submit application" });
      await expect(submitButton, "the required assessment should block submission while empty").toBeDisabled();

      await seekerPage.getByLabel(/Years of backend experience\?/).fill("3");

      const RESPONSE_FILE_CONTENT = "SELECT customer_id, SUM(amount) FROM orders GROUP BY 1 ORDER BY 2 DESC LIMIT 3;";
      await seekerPage.setInputFiles("#assessment-response-file", {
        name: "answer.txt",
        mimeType: "text/plain",
        buffer: Buffer.from(RESPONSE_FILE_CONTENT),
      });
      await expect(seekerPage.getByText("Selected: answer.txt")).toBeVisible();

      await expect(submitButton).toBeEnabled();
      await submitButton.click();
      await expect(seekerPage.getByText("A quick self-assessment before you apply")).toHaveCount(0, {
        timeout: 20_000,
      });
      await seekerContext.close();

      // ---- Employer: read back both, and confirm the file link WORKS ------
      await employerPage.goto(`/employer/jobs/${jobId}/applicants`);
      await employerPage.getByRole("button", { name: "View answers" }).click();
      await expect(employerPage.getByText("Years of backend experience?")).toBeVisible();
      await expect(employerPage.getByText("3", { exact: true })).toBeVisible();

      await employerPage.getByRole("button", { name: "View assessment response" }).click();
      const fileLink = employerPage.getByRole("link", { name: "View response file" });
      await expect(fileLink).toBeVisible();

      const href = await fileLink.getAttribute("href");
      expect(href).toBeTruthy();
      // Fetches the SIGNED url directly (not just asserting the link exists
      // in the DOM) — this is the "actually resolves a working, correctly-
      // scoped link" proof the feature's own spec asks for, not merely that
      // a row exists.
      const fileResponse = await employerPage.request.get(href!);
      expect(fileResponse.ok(), `expected the signed file URL to resolve, got ${fileResponse.status()}`).toBe(true);
      const body = await fileResponse.text();
      expect(body).toBe(RESPONSE_FILE_CONTENT);

      await employerContext.close();
    },
  );
});

/**
 * The `required: false` case — the OTHER half of the feature spec's own
 * regression checklist ("a posting with an assessment, both required: true
 * and required: false, shows the right apply-flow behavior"). The test
 * above only ever exercises required: true; this one was previously only
 * checked once, live, in a browser, by hand — nothing in the suite would
 * have caught a future regression here. A separate describe block with its
 * own fixture state, rather than a second test sharing the block above's
 * module-level `let`s, so the two tests can't interfere if a future change
 * to this file's config ever lets them run concurrently.
 *
 * What "not required" means, precisely, per applyWithScreeningAction's own
 * hasAssessmentResponse guard (src/lib/applications/actions.ts): when the
 * candidate submits with no text/file/link at all, that guard is false, so
 * submit_assessment_response is never called — application_assessment_
 * submissions ends up with NO ROW at all for the application, not an
 * empty/null-ish one. Asserted directly below, not assumed.
 */
base.describe("job posting assessment — required: false", () => {
  let employerUserId: string;
  let seekerUserId: string;
  let orgId: string;

  base.afterEach(async () => {
    await runCleanups(
      [
        "assessment (required:false) e2e organisation",
        async () => {
          if (orgId) await deleteOrgsCascade(admin, [orgId]);
        },
      ],
      [
        "assessment (required:false) e2e users",
        async () => {
          if (employerUserId) await admin.auth.admin.deleteUser(employerUserId).catch(() => {});
          if (seekerUserId) await admin.auth.admin.deleteUser(seekerUserId).catch(() => {});
        },
      ],
    );
  });

  base(
    "an optional (required: false) assessment never blocks submission, and an empty response leaves no submission row",
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
      await seedBaseResume(seekerUserId);

      const orgName = `E2E Assessment Optional Co ${randomUUID().slice(0, 8)}`;
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

      // ---- Employer: post a job with an OPTIONAL assessment, no screening
      //      questions — isolates the required:false behavior on its own ----
      const employerCookie = await mintSessionCookie(employerEmail);
      const employerContext = await browser.newContext();
      await employerContext.addCookies([
        { name: employerCookie.name, value: employerCookie.value, domain: url.hostname, path: "/" },
      ]);
      const employerPage = await employerContext.newPage();

      await employerPage.goto("/employer/jobs/new");
      const jobTitle = `E2E Optional Assessment Backend Engineer ${randomUUID().slice(0, 6)}`;
      await employerPage.getByLabel("Job title").fill(jobTitle);
      await employerPage
        .getByLabel("Job description")
        .fill(
          "We are hiring a backend engineer to work on payment APIs. You will design services, write SQL queries, review code, and mentor other engineers.",
        );

      await employerPage.getByLabel("Attach an assessment (optional)").check();
      await employerPage.getByLabel("Title", { exact: true }).fill("Optional writing sample");
      await employerPage
        .getByLabel("Instructions", { exact: true })
        .fill("If you'd like, share a short writing sample.");
      // Default is checked (required: true) — uncheck it for this case.
      await employerPage.getByLabel("Required to apply").uncheck();
      await expect(employerPage.getByLabel("Required to apply")).not.toBeChecked();

      await employerPage.getByRole("button", { name: "Publish job" }).click();
      await expect(employerPage).toHaveURL(/\/employer\/jobs\?posted=.+$/);
      const jobId = new URL(employerPage.url()).searchParams.get("posted")!;
      await employerContext.close();

      // ---- Seeker: the assessment shows, but nothing blocks submission ----
      const seekerCookie = await mintSessionCookie(seekerEmail);
      const seekerContext = await browser.newContext();
      await seekerContext.addCookies([
        { name: seekerCookie.name, value: seekerCookie.value, domain: url.hostname, path: "/" },
      ]);
      const seekerPage = await seekerContext.newPage();

      await seekerPage.goto(`/jobs/${jobId}`);
      await expect(seekerPage.getByText("Optional writing sample")).toBeVisible();

      const submitButton = seekerPage.getByRole("button", { name: "Submit application" });
      await expect(
        submitButton,
        "an assessment with required: false must never block submission, even with no response entered",
      ).toBeEnabled();

      await submitButton.click();
      await expect(seekerPage.getByText("A quick self-assessment before you apply")).toHaveCount(0, {
        timeout: 20_000,
      });
      await seekerContext.close();

      // ---- Confirm the application succeeded AND that submitting nothing
      //      leaves no application_assessment_submissions row at all — not
      //      an empty one, per hasAssessmentResponse's own guard. ----------
      const { data: application, error: appErr } = await admin
        .from("applications")
        .select("id")
        .eq("job_posting_id", jobId)
        .eq("user_id", seekerUserId)
        .maybeSingle();
      if (appErr) throw appErr;
      expect(application, "the application itself must still be recorded").not.toBeNull();

      const { data: submission, error: subErr } = await admin
        .from("application_assessment_submissions")
        .select("id")
        .eq("application_id", application!.id)
        .maybeSingle();
      if (subErr) throw subErr;
      expect(
        submission,
        "submitting with no text/file/link means hasAssessmentResponse is false and submit_assessment_response is never called — no row should exist",
      ).toBeNull();
    },
  );
});
