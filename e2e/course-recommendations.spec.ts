import { test, expect } from "@playwright/test";

/**
 * Course recommendations on the tailoring screen.
 *
 * THE API RESPONSE IS STUBBED, DELIBERATELY. A real run would call Gemini on
 * the shared free-tier key (20 requests/day for the whole project), spend the
 * demo account's credits, and make the assertions depend on what a model chose
 * to emit that morning. None of that tests the thing under test, which is
 * whether the client renders a ranked list correctly and links it honestly.
 *
 * The ranking itself is covered by unit tests against the real matcher, and
 * the query layer by tests/courses/recommend.test.ts. What only a browser can
 * answer is: does the section appear, does it stay absent when there is
 * nothing to show, and do the links carry `sponsored`.
 */
const DEMO_PASSWORD = process.env.DEMO_PASSWORD;

if (process.env.CI && !DEMO_PASSWORD) {
  // A skip must not read as a pass in CI — the same guard the other
  // signed-in specs use.
  throw new Error("course-recommendations spec cannot run in CI: DEMO_PASSWORD is not set");
}

const RESUME = {
  fullName: "Demo User",
  headline: "",
  contact: {},
  summary: "",
  experience: [],
  education: [],
  skills: [],
  projects: [],
  certifications: [],
};

function payload(courseRecommendations: unknown) {
  return {
    resumeId: "00000000-0000-0000-0000-000000000001",
    coverLetterResumeId: null,
    isFreeTrial: true,
    creditsSpent: 0,
    courseRecommendations,
    result: {
      structuredJd: { title: "Data Analyst", company: null, skills: [], requirements: [] },
      gapAnalysis: [
        { keyword: "SQL", status: "missing", note: "appears 6x in this JD" },
        { keyword: "Stakeholder management", status: "matched" },
      ],
      tailoredResume: RESUME,
      coverLetter: null,
      atsScore: 72,
      atsFixes: ["Add SQL to your skills section"],
      jdTruncation: null,
    },
  };
}

const TWO_COURSES = [
  {
    course: {
      id: "c1",
      skill_tag: "sql",
      provider: "altschool",
      title: "AltSchool of Data — SQL Foundations",
      affiliate_url: "https://altschoolafrica.com/schools/data/sql?ref=talentrah-placeholder",
      price_tier: "free",
    },
    matchedKeyword: "SQL",
    skillTag: "sql",
    jdMentions: 6,
  },
  {
    course: {
      id: "c2",
      skill_tag: "product management",
      provider: "altschool",
      title: "AltSchool of Product Management",
      affiliate_url: "https://altschoolafrica.com/schools/product-management?ref=talentrah-placeholder",
      price_tier: "mid",
    },
    matchedKeyword: "Product Management",
    skillTag: "product management",
    jdMentions: null,
  },
];

async function signInAndOpenTailor(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo@talentrah.dev");
  await page.getByLabel("Password").fill(DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/jobs");
  await page.goto("/tailor");
}

async function runTailoring(page: import("@playwright/test").Page) {
  /*
   * By placeholder, NOT getByRole("textbox").first() — the masthead's global
   * search is a textbox and comes first in the DOM, so the generic locator
   * fills the search field and leaves the JD empty.
   *
   * And the text must clear the textarea's minLength={50}. Native constraint
   * validation blocks submission with no submit event, no error and no
   * network request, so a short fixture looks exactly like a broken handler.
   */
  await page
    .getByPlaceholder("Paste the full job description here")
    .fill(
      "We are hiring a data analyst to build reporting pipelines, own our " +
        "dashboards, and work with stakeholders across the business on SQL.",
    );
  await page.getByRole("button", { name: "Tailor my resume" }).click();
}

test.describe("course recommendations", () => {
  test.skip(!DEMO_PASSWORD, "DEMO_PASSWORD is not set — see scripts/seed.ts");

  test("renders the ranked courses, and labels the links as sponsored", async ({ page }) => {
    await page.route("**/api/tailoring", async (route) => {
      await route.fulfill({ status: 200, json: payload(TWO_COURSES) });
    });
    await signInAndOpenTailor(page);
    await runTailoring(page);

    const section = page.getByTestId("course-recommendations");
    await expect(section).toBeVisible();
    await expect(page.getByTestId("course-recommendation")).toHaveCount(2);

    // Order is the ranker's, and the UI must not resort it.
    const links = section.getByRole("link");
    await expect(links.first()).toHaveText("AltSchool of Data — SQL Foundations");

    // The gap each course answers, echoed verbatim as the model wrote it.
    await expect(section).toContainText("for SQL");

    // Commercial links, declared as such in the markup and in words.
    await expect(links.first()).toHaveAttribute("rel", /sponsored/);
    await expect(links.first()).toHaveAttribute("target", "_blank");
    await expect(section).toContainText("Partner links");

    // Free tier is the one price signal shown, and only when it applies.
    await expect(section).toContainText("Free");
  });

  test("the whole block is absent when there is nothing to recommend", async ({ page }) => {
    /*
     * The common case. An empty state here would be a standing apology for the
     * catalog's size on a screen about the user's resume — so the assertion is
     * that nothing renders at all, not that a placeholder renders.
     */
    await page.route("**/api/tailoring", async (route) => {
      await route.fulfill({ status: 200, json: payload([]) });
    });
    await signInAndOpenTailor(page);
    await runTailoring(page);

    // The result itself arrived — otherwise this would pass for the wrong
    // reason, which is the failure mode an absence assertion invites.
    await expect(page.getByText("Gap analysis")).toBeVisible();
    await expect(page.getByTestId("course-recommendations")).toHaveCount(0);
  });
});
