/**
 * send-445 — Quazim added 5 screening questions on
 * `/employer/jobs/[id]/edit`, and on reopening the edit page only 2 were
 * there. Traced directly against real production evidence (edge_logs,
 * `job_posting_screening_questions` rows): the server received and saved
 * exactly 2 questions in a single clean POST — nothing was truncated,
 * dropped, or deleted afterward. The 3 "missing" questions never reached
 * the server at all.
 *
 * The real mechanism: JobPostingForm renders ONE `<form>` containing every
 * field — title, location, salary, years of experience, and every
 * screening-question input — as a plain single-line `<input>`. Pressing
 * Enter inside any of them (a completely normal thing to do after typing a
 * line) triggers the browser's OWN implicit form submission — standard
 * HTML behaviour, not a framework bug — submitting the whole job with
 * whatever is in state at that instant. `SkillsAutocomplete`'s own input
 * already guards against exactly this (`e.preventDefault()` in its own
 * onKeyDown); nothing else in this form did, until this send's form-level
 * guard.
 *
 * This test proves the failure mode directly: two questions added, Enter
 * pressed while focused in the SECOND question's text field (mid-typing,
 * before a 3rd question is ever added — the same moment the evidence
 * points to), then asserts the form did NOT submit — not that some
 * downstream count came out right, since the whole point is that an early
 * submit here is invisible to any check that only runs after a real
 * "Publish job" click. A second case confirms the guard doesn't fight
 * SkillsAutocomplete's own Enter handling or the rich description editor's
 * own newline-on-Enter behaviour, and that a real "Publish job" click still
 * works end to end.
 */
import { test, expect, admin } from "./fixtures/authed";
import { runCleanups } from "../tests/support/teardown";
import { deleteOrgsCascade } from "../tests/support/delete-orgs";
import type { Page } from "@playwright/test";

async function createVerifiedOrg(page: Page, orgName: string) {
  await page.goto("/employer/onboarding");
  await page.getByLabel("Company name").fill(orgName);
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page).toHaveURL(/\/employer\/jobs$/);
  const { data: org } = await admin.from("organizations").select("id").eq("name", orgName).single();
  await admin.from("organizations").update({ verified: true }).eq("id", org!.id);
  return org!.id as string;
}

test.describe("pressing Enter in a job-posting form field must not submit the form early", () => {
  let orgId: string | undefined;

  test.afterEach(async () => {
    await runCleanups([
      "enter-key e2e organisation",
      async () => {
        if (orgId) await deleteOrgsCascade(admin, [orgId]);
      },
    ]);
  });

  test("Enter in a screening question's text field does not create the job with a partial question set", async ({
    authedPage,
    testUser,
  }) => {
    orgId = await createVerifiedOrg(authedPage, `E2E Enter-Key Co ${testUser.id.slice(0, 8)}`);

    const jobTitle = `E2E Enter-Key Role ${testUser.id.slice(0, 6)}`;
    await authedPage.goto("/employer/jobs/new");
    await authedPage.getByLabel("Job title").fill(jobTitle);
    await authedPage
      .getByLabel("Job description")
      .fill("A short internal role description, at least a couple of sentences long.");
    await authedPage.getByLabel("Skills seekers are matched against").fill("sql");
    await authedPage.getByLabel("Skills seekers are matched against").press("Enter");

    // Two questions added — mirrors the real report: several questions
    // typed before the employer ever meant to submit.
    await authedPage.getByRole("button", { name: "+ Add question" }).click();
    await authedPage.getByRole("button", { name: "+ Add question" }).click();
    const questionFields = authedPage.getByRole("textbox", { name: "Question", exact: true });
    await questionFields.nth(0).fill("Are you authorised to work in Nigeria?");
    await questionFields.nth(1).fill("How many years of SQL experience do you have?");

    // The exact moment the evidence points to: Enter pressed while still
    // focused in a question's own text field, mid-form, nowhere near the
    // submit button.
    await questionFields.nth(1).press("Enter");

    // ---- The actual proof: the form must NOT have submitted. A real bug
    //      here would navigate to /employer/jobs?posted=... and create the
    //      job with whatever was in state — checking only a downstream
    //      count (e.g. "2 questions saved") would not catch an early
    //      submit that happens to look clean, which is exactly how the
    //      real report went unnoticed until a reopen.
    await expect(authedPage).toHaveURL(/\/employer\/jobs\/new$/);
    await expect(authedPage.getByRole("button", { name: "Publish job" })).toBeVisible();
    const { count } = await admin
      .from("job_postings")
      .select("id", { count: "exact", head: true })
      .eq("title", jobTitle);
    expect(count, "an early Enter-triggered submit must not have created the job at all").toBe(0);

    // Both questions' text must have survived (the guard didn't blur/clear
    // anything), and a REAL submit afterward still works end to end.
    await expect(questionFields.nth(0)).toHaveValue("Are you authorised to work in Nigeria?");
    await expect(questionFields.nth(1)).toHaveValue("How many years of SQL experience do you have?");

    await authedPage.getByRole("button", { name: "Publish job" }).click();
    await expect(authedPage).toHaveURL(/\/employer\/jobs\?posted=.+$/);
    const jobId = new URL(authedPage.url()).searchParams.get("posted")!;

    const { data: savedQuestions } = await admin
      .from("job_posting_screening_questions")
      .select("question_text")
      .eq("job_posting_id", jobId)
      .order("sort_order", { ascending: true });
    expect(savedQuestions?.map((q) => q.question_text)).toEqual([
      "Are you authorised to work in Nigeria?",
      "How many years of SQL experience do you have?",
    ]);
  });

  test("Enter still commits the top skill suggestion, and still inserts a newline in the description editor", async ({
    authedPage,
    testUser,
  }) => {
    orgId = await createVerifiedOrg(authedPage, `E2E Enter-Key Editor Co ${testUser.id.slice(0, 8)}`);

    await authedPage.goto("/employer/jobs/new");
    await authedPage.getByLabel("Job title").fill(`E2E Enter-Key Editor Role ${testUser.id.slice(0, 6)}`);

    // The rich description editor: Enter must still insert a real newline
    // (a second paragraph), not be swallowed by the form-level guard.
    await authedPage.locator("#description").click();
    await authedPage.keyboard.type("First line of the description, long enough on its own.");
    await authedPage.keyboard.press("Enter");
    await authedPage.keyboard.type("Second line, after a real Enter-created paragraph break.");
    await expect(authedPage.locator("#description p")).toHaveCount(2);
    await expect(authedPage).toHaveURL(/\/employer\/jobs\/new$/);

    // SkillsAutocomplete: Enter commits the top suggestion, not the raw
    // typed text, and must not submit the form either.
    await authedPage.getByLabel("Skills seekers are matched against").fill("sq");
    await authedPage.getByLabel("Skills seekers are matched against").press("Enter");
    await expect(authedPage.getByText("sql", { exact: true })).toBeVisible();
    await expect(authedPage).toHaveURL(/\/employer\/jobs\/new$/);
  });
});
