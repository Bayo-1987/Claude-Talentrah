import { test, expect } from "@playwright/test";

/**
 * TAILORING-NOTICE-UI-1. /api/tailoring answers 200 with a `notice` when the tailored resume saved but the cover letter did not and the
 * letter's charge was given back (#951). The screen has to show it. tests/tailoring/tailor-form-notice.test.tsx pins the render; this is
 * the half only a browser can answer: that the real `fetch` -> `setData(json)` path carries the field through, that it is on screen at
 * phone width without scrolling, and that nothing offers to dismiss it.
 *
 * THE API RESPONSE IS STUBBED, for the reason e2e/course-recommendations.spec.ts gives: a real run spends credits and calls the model,
 * and the server half (when `notice` is sent, and its wording) is covered by tests/tailoring/route-refund-on-failed-save.test.ts.
 */
const DEMO_PASSWORD = process.env.DEMO_PASSWORD;

if (process.env.CI && !DEMO_PASSWORD) {
  throw new Error("tailoring-notice spec cannot run in CI: DEMO_PASSWORD is not set");
}

const NOTICE = "Your tailored resume saved, but the cover letter didn't. Your 5 credits were returned.";
const FAILED_GIVE_BACK =
  "Your tailored resume saved, but the cover letter didn't. We couldn't give your credits back automatically. " +
  "Please contact support and quote this time: 2026-10-17T09:30:00.000Z.";

function payload(extra: Record<string, unknown>) {
  return {
    resumeId: "00000000-0000-0000-0000-000000000001",
    coverLetterResumeId: null,
    isFreeTrial: true,
    creditsSpent: 0,
    courseRecommendations: [],
    result: {
      structuredJd: { title: "Data Analyst", company: null, skills: [], requirements: [] },
      gapAnalysis: [{ keyword: "SQL", status: "missing", note: "appears 6x in this JD" }],
      tailoredResume: {
        fullName: "Demo User",
        headline: "",
        contact: {},
        summary: "",
        experience: [],
        education: [],
        skills: [],
        projects: [],
        certifications: [],
      },
      coverLetter: null,
      atsScore: 72,
      atsFixes: ["Add SQL to your skills section"],
      jdTruncation: null,
    },
    ...extra,
  };
}

async function signInAndRun(page: import("@playwright/test").Page, body: unknown) {
  await page.route("**/api/tailoring", async (route) => {
    await route.fulfill({ status: 200, json: body });
  });
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo@talentrah.dev");
  await page.getByLabel("Password", { exact: true }).fill(DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/jobs");
  await page.goto("/tailor");
  await page
    .getByPlaceholder("Paste the full job description here")
    .fill(
      "We are hiring a data analyst to build reporting pipelines, own our " +
        "dashboards, and work with stakeholders across the business on SQL.",
    );
  await page.getByRole("button", { name: "Tailor my resume" }).click();
  // This account's free run may already be spent, in which case the run asks before charging.
  const confirm = page.getByTestId("tailor-confirm");
  await confirm
    .waitFor({ state: "visible", timeout: 1_500 })
    .then(() => confirm.getByRole("button", { name: "Confirm and tailor" }).click())
    .catch(() => {});
}

test.describe("tailoring notice", () => {
  test.skip(!DEMO_PASSWORD, "DEMO_PASSWORD is not set — see scripts/seed.ts");

  test.describe("at phone width", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("the notice is on screen without scrolling, as a status, with nothing to dismiss it", async ({ page }) => {
      await signInAndRun(page, payload({ notice: NOTICE }));

      // Generous first timeout: a local `next dev` compiles /tailor on first hit (see course-recommendations.spec.ts).
      const notice = page.getByTestId("tailoring-notice");
      await expect(notice).toBeVisible({ timeout: 30_000 });
      await expect(notice).toHaveText(NOTICE);
      await expect(notice).toHaveAttribute("role", "status");
      await expect(notice).toBeInViewport();
      await expect(notice.getByRole("button")).toHaveCount(0);
      await expect(notice.getByRole("link")).toHaveCount(0);
      // The result itself arrived: the notice is added to the success screen, it does not replace it.
      await expect(page.getByText("Gap analysis")).toBeVisible();
    });
  });

  test("the failed-give-back wording arrives unchanged", async ({ page }) => {
    await signInAndRun(page, payload({ notice: FAILED_GIVE_BACK }));
    await expect(page.getByTestId("tailoring-notice")).toHaveText(FAILED_GIVE_BACK, { timeout: 30_000 });
  });

  test("a 200 without a notice shows no notice", async ({ page }) => {
    await signInAndRun(page, payload({}));
    // Wait for the result first, so the absence below is not just "not rendered yet".
    await expect(page.getByText("Gap analysis")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("tailoring-notice")).toHaveCount(0);
  });
});
