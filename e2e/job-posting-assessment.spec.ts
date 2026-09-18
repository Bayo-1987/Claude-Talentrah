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
 * getApplicationAssessmentSubmissionAction always return no working file
 * links regardless of what's on file, confirmed this test's own "View
 * response file" link assertion failed exactly where expected, then
 * restored the real signed-URL logic and re-confirmed green. (A live
 * mutation of the shared dev database's own can_access_assessment_
 * submission function — the more direct sabotage target for the storage
 * policy itself — was attempted first and correctly refused as a
 * shared-resource risk; that policy's four read combinations are instead
 * pinned directly, and independently sabotage-worthy in their own right,
 * by tests/employer/assessment-storage-rls.test.ts.)
 *
 * send-365 (migration 0179) widened the candidate's response from a
 * single file to up to MAX_ASSESSMENT_FILES — this spec's own single-file
 * upload above still exercises the real end-to-end loop (one file is a
 * valid subset of "up to 5"); the multiple-files case has its own
 * dedicated e2e test further down this file.
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

/**
 * send-364 (migration 0178) — the actual capability this send exists to
 * deliver: an employer attaches MULTIPLE exercise files while CREATING the
 * job posting, not as a separate trip to Edit afterward. Drives the real
 * staging path end to end: pick 2 files on /employer/jobs/new (staged into
 * IndexedDB by new-job-assessment-files-picker.tsx, since no jobId exists
 * yet), publish, let PostSuccessAssessmentFilesNote consume-and-upload them
 * once a real jobId does exist, then confirm on Edit that both are genuinely
 * attached — not just that two rows exist, but that each one resolves a
 * WORKING public URL whose content matches exactly what was picked.
 */
base.describe("job posting assessment — multiple files staged at create time (send-364)", () => {
  let employerUserId: string;
  let orgId: string;

  base.afterEach(async () => {
    await runCleanups(
      [
        "assessment create-time files e2e organisation",
        async () => {
          if (orgId) await deleteOrgsCascade(admin, [orgId]);
        },
      ],
      [
        "assessment create-time files e2e user",
        async () => {
          if (employerUserId) await admin.auth.admin.deleteUser(employerUserId).catch(() => {});
        },
      ],
    );
  });

  base(
    "two files picked on the create form attach automatically after publishing, and both resolve real, correct content",
    async ({ browser, baseURL }) => {
      base.setTimeout(60_000);
      const domain = `${randomUUID().slice(0, 12)}.talentrah.test`;
      const employerEmail = `employer-${randomUUID()}@${domain}`;

      const { data: employerUser, error: eErr } = await admin.auth.admin.createUser({
        email: employerEmail,
        email_confirm: true,
      });
      if (eErr) throw eErr;
      employerUserId = employerUser.user.id;

      const orgName = `E2E Assessment Create-Files Co ${randomUUID().slice(0, 8)}`;
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
      const employerCookie = await mintSessionCookie(employerEmail);
      const employerContext = await browser.newContext();
      await employerContext.addCookies([
        { name: employerCookie.name, value: employerCookie.value, domain: url.hostname, path: "/" },
      ]);
      const employerPage = await employerContext.newPage();

      const BRIEF_CONTENT = "Design a schema for a multi-tenant SaaS billing system.";
      const SHEET_CONTENT = "task,owner,due\nSchema draft,you,Friday\n";

      await employerPage.goto("/employer/jobs/new");
      const jobTitle = `E2E Create-Time Files Backend Engineer ${randomUUID().slice(0, 6)}`;
      await employerPage.getByLabel("Job title").fill(jobTitle);
      await employerPage
        .getByLabel("Job description")
        .fill(
          "We are hiring a backend engineer to work on payment APIs. You will design services, write SQL queries, review code, and mentor other engineers.",
        );

      // ---- The new multi-file picker, on the CREATE form, before any
      //      job_posting_id exists at all. ------------------------------
      await employerPage.setInputFiles("#new-job-assessment-files", [
        { name: "brief.txt", mimeType: "text/plain", buffer: Buffer.from(BRIEF_CONTENT) },
        { name: "tasks.csv", mimeType: "text/plain", buffer: Buffer.from(SHEET_CONTENT) },
      ]);

      await expect(employerPage.getByText("brief.txt")).toBeVisible();
      await expect(employerPage.getByText("tasks.csv")).toBeVisible();

      await employerPage.getByLabel("Attach an assessment (optional)").check();
      await employerPage.getByLabel("Title", { exact: true }).fill("Schema design exercise");
      await employerPage
        .getByLabel("Instructions", { exact: true })
        .fill("Read the attached brief and spreadsheet, then design the schema.");

      await employerPage.getByRole("button", { name: "Publish job" }).click();
      await expect(employerPage).toHaveURL(/\/employer\/jobs\?posted=.+$/);
      const jobId = new URL(employerPage.url()).searchParams.get("posted")!;

      // ---- The post-success card's own deferred upload — this is the
      //      actual moment the staged files get attached, once a real
      //      jobId finally exists. ----------------------------------------
      await expect(employerPage.getByText("Assessment files added.")).toBeVisible({ timeout: 20_000 });

      // ---- Confirm on Edit: both files genuinely attached, each with a
      //      WORKING link whose content matches exactly what was picked —
      //      not just that two rows exist. -----------------------------
      await employerPage.goto(`/employer/jobs/${jobId}/edit`);
      const briefLink = employerPage.getByRole("link", { name: /brief\.txt/ });
      const sheetLink = employerPage.getByRole("link", { name: /tasks\.csv/ });
      await expect(briefLink).toBeVisible();
      await expect(sheetLink).toBeVisible();

      const briefHref = await briefLink.getAttribute("href");
      const sheetHref = await sheetLink.getAttribute("href");
      expect(briefHref).toBeTruthy();
      expect(sheetHref).toBeTruthy();

      const briefResponse = await employerPage.request.get(briefHref!);
      expect(briefResponse.ok()).toBe(true);
      expect(await briefResponse.text()).toBe(BRIEF_CONTENT);

      const sheetResponse = await employerPage.request.get(sheetHref!);
      expect(sheetResponse.ok()).toBe(true);
      expect(await sheetResponse.text()).toBe(SHEET_CONTENT);

      // ---- The DELETE route (send-364 closing send-363's own "can't
      //      remove just one file" gap): removing ONE file leaves the
      //      OTHER genuinely untouched, and the removed one is actually
      //      gone at the STORAGE level, not just hidden client-side.
      //      Checked directly against storage.objects, not the removed
      //      file's public URL — this bucket's objects upload with
      //      `cacheControl: max-age=3600`, so a CDN can keep serving a
      //      just-deleted object's bytes for up to an hour, which would
      //      make a URL-based check flaky for a reason that has nothing to
      //      do with whether the removal itself actually worked. ---------
      const briefPath = new URL(briefHref!).pathname.split(`/job-assessment-exercises/`)[1]!;
      const briefRow = employerPage.locator("li", { hasText: "brief.txt" });
      await briefRow.getByRole("button", { name: "Remove" }).click();
      await expect(employerPage.getByText("brief.txt")).toHaveCount(0, { timeout: 10_000 });
      await expect(sheetLink).toBeVisible();

      const { data: stillListed } = await admin.storage
        .from("job-assessment-exercises")
        .list(briefPath.split("/").slice(0, -1).join("/"), { search: briefPath.split("/").pop() });
      expect(
        (stillListed ?? []).some((f) => briefPath.endsWith(f.name)),
        "the removed file's storage object must actually be gone, not just its DB row",
      ).toBe(false);

      const stillWorkingResponse = await employerPage.request.get(sheetHref!);
      expect(stillWorkingResponse.ok(), "removing one file must not disturb the other").toBe(true);
      expect(await stillWorkingResponse.text()).toBe(SHEET_CONTENT);

      await employerContext.close();
    },
  );
});

/**
 * send-365 (migration 0179) — the candidate-side mirror of send-364: a
 * seeker attaches MULTIPLE files to their assessment response (up to
 * MAX_ASSESSMENT_FILES), not just one. No IndexedDB staging is involved
 * here (see screening-gate-apply.tsx's own header on why the candidate
 * side doesn't need it — there is no cross-page redirect between picking
 * and submitting), but the same "each file must genuinely resolve, not
 * just have a row" discipline this whole feature already holds itself to
 * applies: both files are fetched via their real signed URLs and their
 * content is checked byte-for-byte, and the employer's applicant view is
 * confirmed to show BOTH, not just the first.
 */
base.describe("job posting assessment — candidate attaches multiple response files (send-365)", () => {
  let employerUserId: string;
  let seekerUserId: string;
  let orgId: string;

  base.afterEach(async () => {
    await runCleanups(
      [
        "assessment multi-response-file e2e organisation",
        async () => {
          if (orgId) await deleteOrgsCascade(admin, [orgId]);
        },
      ],
      [
        "assessment multi-response-file e2e users",
        async () => {
          if (employerUserId) await admin.auth.admin.deleteUser(employerUserId).catch(() => {});
          if (seekerUserId) await admin.auth.admin.deleteUser(seekerUserId).catch(() => {});
        },
      ],
    );
  });

  base(
    "a seeker attaches 2 response files; both land atomically and both resolve real, correct content to the employer",
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

      const orgName = `E2E Assessment Multi-Response Co ${randomUUID().slice(0, 8)}`;
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

      // ---- Employer: post a job with a required assessment, no exercise
      //      file/link needed for this test -------------------------------
      const employerCookie = await mintSessionCookie(employerEmail);
      const employerContext = await browser.newContext();
      await employerContext.addCookies([
        { name: employerCookie.name, value: employerCookie.value, domain: url.hostname, path: "/" },
      ]);
      const employerPage = await employerContext.newPage();

      await employerPage.goto("/employer/jobs/new");
      const jobTitle = `E2E Multi-Response Backend Engineer ${randomUUID().slice(0, 6)}`;
      await employerPage.getByLabel("Job title").fill(jobTitle);
      await employerPage
        .getByLabel("Job description")
        .fill(
          "We are hiring a backend engineer to work on payment APIs. You will design services, write SQL queries, review code, and mentor other engineers.",
        );
      await employerPage.getByLabel("Attach an assessment (optional)").check();
      await employerPage.getByLabel("Title", { exact: true }).fill("Short writing sample");
      await employerPage
        .getByLabel("Instructions", { exact: true })
        .fill("Attach up to a few files describing your approach.");

      await employerPage.getByRole("button", { name: "Publish job" }).click();
      await expect(employerPage).toHaveURL(/\/employer\/jobs\?posted=.+$/);
      const jobId = new URL(employerPage.url()).searchParams.get("posted")!;
      await employerContext.close();

      // ---- Seeker: attach 2 response files -------------------------------
      const seekerCookie = await mintSessionCookie(seekerEmail);
      const seekerContext = await browser.newContext();
      await seekerContext.addCookies([
        { name: seekerCookie.name, value: seekerCookie.value, domain: url.hostname, path: "/" },
      ]);
      const seekerPage = await seekerContext.newPage();

      const APPROACH_CONTENT = "My approach: normalize the schema, then add targeted indexes.";
      const NOTES_CONTENT = "Extra notes: watch for N+1 queries in the reporting job.";

      await seekerPage.goto(`/jobs/${jobId}`);
      await expect(seekerPage.getByText("Short writing sample")).toBeVisible();

      await seekerPage.setInputFiles("#assessment-response-file", [
        { name: "approach.txt", mimeType: "text/plain", buffer: Buffer.from(APPROACH_CONTENT) },
        { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from(NOTES_CONTENT) },
      ]);
      await expect(seekerPage.getByText("Selected: approach.txt")).toBeVisible();
      await expect(seekerPage.getByText("Selected: notes.txt")).toBeVisible();

      const submitButton = seekerPage.getByRole("button", { name: "Submit application" });
      await expect(submitButton).toBeEnabled();
      await submitButton.click();
      await expect(seekerPage.getByText("A quick self-assessment before you apply")).toHaveCount(0, {
        timeout: 20_000,
      });
      await seekerContext.close();

      // ---- Employer: both files show, both resolve real, correct content ---
      const employerCookie2 = await mintSessionCookie(employerEmail);
      const employerContext2 = await browser.newContext();
      await employerContext2.addCookies([
        { name: employerCookie2.name, value: employerCookie2.value, domain: url.hostname, path: "/" },
      ]);
      const employerPage2 = await employerContext2.newPage();

      await employerPage2.goto(`/employer/jobs/${jobId}/applicants`);
      await employerPage2.getByRole("button", { name: "View assessment response" }).click();

      const approachLink = employerPage2.getByRole("link", { name: /approach\.txt/ });
      const notesLink = employerPage2.getByRole("link", { name: /notes\.txt/ });
      await expect(approachLink).toBeVisible();
      await expect(notesLink).toBeVisible();

      const approachHref = await approachLink.getAttribute("href");
      const notesHref = await notesLink.getAttribute("href");
      expect(approachHref).toBeTruthy();
      expect(notesHref).toBeTruthy();

      const approachResponse = await employerPage2.request.get(approachHref!);
      expect(approachResponse.ok()).toBe(true);
      expect(await approachResponse.text()).toBe(APPROACH_CONTENT);

      const notesResponse = await employerPage2.request.get(notesHref!);
      expect(notesResponse.ok()).toBe(true);
      expect(await notesResponse.text()).toBe(NOTES_CONTENT);

      await employerContext2.close();
    },
  );
});
