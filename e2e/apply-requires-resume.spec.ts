/**
 * A signed-in user with no base resume could still submit an internal
 * application, on every surface that offers one.
 *
 * `performInAppApply` (src/lib/applications/actions.ts) treats a missing
 * base resume as legitimate and inserts `resume_id: null` — correct once
 * someone has actually committed to applying, since a query ERROR there is
 * fatal but a genuinely absent resume is not. What was missing was upstream
 * of it: nothing stopped the click from happening in the first place.
 *
 * Confirmed live in production, not hypothetical, before this was fixed:
 * one real `internal_apply` application exists with `resume_id IS NULL`,
 * from a user whose `profiles.onboarding_skipped_at` is set — they
 * deliberately skipped resume upload at signup, then hit Apply on a real
 * posting with nothing for the recruiter to read.
 *
 * The fix threads the already-computed `hasBaseResume` (feed) /
 * `baseResume`/`baseResumeError` (detail page) down into a gate that swaps
 * Apply for an "Add a resume to apply" link, on both surfaces, before
 * either the plain one-click form or the screening self-assessment gate can
 * render. `/resume-builder`, not `/onboarding` — `/onboarding` redirects
 * away immediately for a user with `onboarding_skipped_at` set (see that
 * page's own comment), which is exactly the population this exists for.
 *
 * External-job apply is explicitly out of scope: there is no `resume_id`
 * expectation for a posting a candidate applies to off-platform.
 */
import { test, expect, admin, seedBaseResume } from "./fixtures/authed";
import { ROUTE_LOADING_TESTID } from "@/components/ui/skeleton";

interface InternalJob {
  id: string;
  title: string;
}

/**
 * A real internal, open posting with zero screening questions — needed so
 * the "plain one-click apply" and "no base resume" assertions aren't
 * accidentally exercising the screening gate instead. The embedded
 * `job_posting_screening_questions(id)` count is a real join on the FK
 * (0171), not a second query per candidate row.
 */
async function internalJobWithNoScreeningQuestions(): Promise<InternalJob> {
  const { data: jobs, error } = await admin
    .from("job_postings")
    .select("id, title, job_posting_screening_questions(id)")
    .eq("source_type", "internal")
    .eq("status", "open")
    .limit(25);
  if (error) throw error;
  const found = (jobs ?? []).find(
    (j) => (j as unknown as { job_posting_screening_questions: unknown[] }).job_posting_screening_questions.length === 0,
  );
  if (!found) {
    throw new Error(
      "no internal open job with zero screening questions found in seed data — run `npm run seed`",
    );
  }
  return { id: found.id, title: found.title };
}

test.describe("apply requires a base resume", () => {
  let addedQuestionId: string | undefined;

  test.afterEach(async () => {
    if (addedQuestionId) {
      await admin.from("job_posting_screening_questions").delete().eq("id", addedQuestionId);
      addedQuestionId = undefined;
    }
  });

  test("feed: every internal card offers 'Add a resume to apply', never a bare Apply, with no base resume", async ({
    authedPage,
  }) => {
    // ONE browser call looks at every card, so the time does not grow with the board. The default /jobs tab renders the whole scored board (up to 2000 cards), and the CI
    // database holds whatever the live external boards returned when `npm run seed` ran its real ingestion; the old per-card loop (three awaited reads per card) took 3-5 s
    // in most runs and ~32 s, a failure at the 30 s default, in others. 60 s is the margin kept until ten green runs on main; then this goes back to the default.
    test.setTimeout(60_000);
    await authedPage.goto("/jobs");
    await expect(authedPage.getByTestId(ROUTE_LOADING_TESTID)).toHaveCount(0, { timeout: 15000 });

    const cards = authedPage.getByTestId("job-card");
    await expect(cards.first(), "the feed should render at least one card").toBeVisible();

    // Every card, no bound: an internal one (no "sourced externally" text) must show the "Add a resume to apply" link and must not have a bare "Apply" button.
    const inspect = () =>
      cards.evaluateAll((els) => {
        const shown = (e: Element) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
        let internalCount = 0;
        const offenders: string[] = [];
        els.forEach((el, i) => {
          if ((el.textContent ?? "").includes("sourced externally")) return;
          internalCount++;
          const hasGate = [...el.querySelectorAll("a")].some((a) => (a.textContent ?? "").trim() === "Add a resume to apply" && shown(a));
          const bareApply = [...el.querySelectorAll("button")].some((b) => (b.textContent ?? "").trim() === "Apply" || b.getAttribute("aria-label") === "Apply");
          const title = (el.querySelector("h2, h3")?.textContent ?? "").trim().slice(0, 60);
          if (!hasGate) offenders.push(`card ${i} "${title}": no 'Add a resume to apply' link`);
          if (bareApply) offenders.push(`card ${i} "${title}": a bare Apply button`);
        });
        return { total: els.length, internalCount, offenders };
      });

    // Polled so a card that finishes rendering a moment late is retried; the failure message lists the offending cards.
    await expect.poll(async () => (await inspect()).offenders, { message: "internal cards that offer a bare Apply, or lack 'Add a resume to apply'", timeout: 15000 }).toEqual([]);

    const { total, internalCount } = await inspect();
    test.info().annotations.push({ type: "feed-cards", description: `${total} cards on the feed, ${internalCount} internal` });
    expect(internalCount, "no internal job card was on the feed to check").toBeGreaterThan(0);
  });

  test("job detail page, no screening questions: shows the gate instead of the plain apply form", async ({
    authedPage,
  }) => {
    const job = await internalJobWithNoScreeningQuestions();
    await authedPage.goto(`/jobs/${job.id}`);

    const gate = authedPage.getByRole("link", { name: "Add a resume to apply" });
    await expect(gate).toBeVisible();
    await expect(gate).toHaveAttribute("href", "/resume-builder");
    await expect(authedPage.getByRole("button", { name: "Apply", exact: true })).toHaveCount(0);
  });

  test("job detail page, WITH screening questions: shows the gate instead of the self-assessment form", async ({
    authedPage,
  }) => {
    const job = await internalJobWithNoScreeningQuestions();
    const { data: question, error } = await admin
      .from("job_posting_screening_questions")
      .insert({
        job_posting_id: job.id,
        question_text: "Do you have 3+ years of experience?",
        question_type: "yes_no",
        expected_yes_no: true,
        required: true,
      })
      .select("id")
      .single();
    if (error) throw error;
    addedQuestionId = question!.id;

    await authedPage.goto(`/jobs/${job.id}`);

    // The resume gate wins — a resume-less candidate never even sees the
    // self-assessment for an application the recruiter still can't use.
    await expect(authedPage.getByRole("link", { name: "Add a resume to apply" })).toBeVisible();
    await expect(authedPage.getByText("A quick self-assessment before you apply")).toHaveCount(0);
  });

  test("a signed-in user with no base resume can never create an applications row via the UI", async ({
    authedPage,
    testUser,
  }) => {
    const job = await internalJobWithNoScreeningQuestions();
    await authedPage.goto(`/jobs/${job.id}`);
    await expect(authedPage.getByRole("link", { name: "Add a resume to apply" })).toBeVisible();

    // No submit control of any kind exists on the page for this user/job —
    // nothing left to click. Confirmed against the database directly, the
    // same way the real production instance of this bug was found.
    const { data: apps, error } = await admin
      .from("applications")
      .select("id")
      .eq("user_id", testUser.id)
      .eq("job_posting_id", job.id);
    if (error) throw error;
    expect(apps ?? []).toHaveLength(0);
  });

  test("a signed-in user WITH a base resume sees zero change: one-click apply still works", async ({
    authedPage,
    testUser,
  }) => {
    await seedBaseResume(testUser.id);
    const job = await internalJobWithNoScreeningQuestions();
    await authedPage.goto(`/jobs/${job.id}`);

    await expect(authedPage.getByRole("link", { name: "Add a resume to apply" })).toHaveCount(0);
    const applyButton = authedPage.getByRole("button", { name: "Apply", exact: true });
    await expect(applyButton).toBeVisible();
    await applyButton.click();

    // performInAppApply's own match-scoring step makes this slower than a
    // typical click — same longer timeout screening-questions.spec.ts uses
    // for the equivalent post-apply state change.
    await expect(authedPage.getByText("Applied", { exact: true })).toBeVisible({ timeout: 20_000 });

    const { data: application, error } = await admin
      .from("applications")
      .select("resume_id")
      .eq("user_id", testUser.id)
      .eq("job_posting_id", job.id)
      .single();
    if (error) throw error;
    expect(application?.resume_id, "a resume-holding user's apply must record it").not.toBeNull();
  });

  test("external-job apply is unaffected regardless of resume status", async ({ authedPage }) => {
    const { data: externalJob, error } = await admin
      .from("job_postings")
      .select("id, title")
      .eq("source_type", "external")
      .eq("status", "open")
      .limit(1)
      .single();
    if (error || !externalJob) throw new Error(`no external open job in seed data: ${error?.message}`);

    await authedPage.goto(`/jobs/${externalJob.id}`);
    await expect(authedPage.getByRole("link", { name: "Add a resume to apply" })).toHaveCount(0);
    await expect(authedPage.getByRole("link", { name: "Apply on company site" })).toBeVisible();
    await expect(authedPage.getByRole("button", { name: "Mark as applied" })).toBeVisible();
  });
});
