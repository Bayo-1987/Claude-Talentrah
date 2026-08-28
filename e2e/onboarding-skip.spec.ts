import { test, expect, seedBaseResume } from "./fixtures/authed";

/**
 * /onboarding must only onboard people who have not onboarded.
 *
 * THE BUG. The page rendered the upload prompt for anyone who reached it,
 * with no check for what it exists to produce. The visible route in is OAuth:
 * signing in again with Google or LinkedIn in a fresh session sends a
 * returning user — resume already uploaded, profile already filled — back
 * through "upload your resume" as though the account were new. It is the one
 * screen whose job is to make the product feel like it knows you.
 *
 * BOTH DIRECTIONS ARE TESTED, and the second is the one that makes the first
 * safe. A gate like this fails in two ways, and only one of them is loud:
 *
 *   too narrow  the returning user still sees the prompt. Annoying, visible,
 *               someone reports it.
 *   too wide    a genuinely new user is redirected away from the only screen
 *               that uploads a resume, and lands on a feed that scores every
 *               job against an empty document. Nothing errors. That is the
 *               expensive one, and "a new user still sees the prompt" is the
 *               assertion that catches it.
 *
 * The fixture is what makes this cheap: `testUser` is a genuinely fresh
 * account with no rows anywhere, so the new-user case needs no setup at all —
 * it is the fixture's natural state. The returning-user case is that same
 * account plus one seeded base resume, so the two tests differ by exactly the
 * thing under test and nothing else.
 */

test.describe("/onboarding", () => {
  test("a new user with no resume still sees the upload prompt", async ({ authedPage }) => {
    await authedPage.goto("/onboarding");

    // Still on the page, not bounced.
    await expect(authedPage).toHaveURL(/\/onboarding/);
    await expect(authedPage.getByRole("heading", { name: /Ready to land your dream job/ })).toBeVisible();
    // And the thing the page is for is actually rendered, not just its chrome.
    await expect(authedPage.getByRole("button", { name: "Choose a file" })).toBeVisible();
  });

  test("a returning user who already has a resume is sent straight through", async ({
    authedPage,
    testUser,
  }) => {
    await seedBaseResume(testUser.id);

    await authedPage.goto("/onboarding");

    await authedPage.waitForURL("**/jobs");
    // The prompt must be gone, not merely scrolled past — asserting on the URL
    // alone would pass if the page rendered and then client-navigated.
    await expect(authedPage.getByRole("button", { name: "Choose a file" })).toHaveCount(0);
  });

  test("the redirect honours ?next= instead of always dropping you on /jobs", async ({
    authedPage,
    testUser,
  }) => {
    /*
     * `next` is already computed for the upload flow, and the skip reuses it.
     * Worth pinning: a returning user who followed a link to somewhere
     * specific should arrive there, and sending everyone to /jobs would be a
     * quieter version of the same "the product forgot what you were doing"
     * problem this fix is about.
     */
    await seedBaseResume(testUser.id);

    await authedPage.goto("/onboarding?next=%2Ftracker");

    await authedPage.waitForURL("**/tracker");
  });

  test("a hostile ?next= is not followed", async ({ authedPage, testUser }) => {
    // safeRedirectTo already refuses these; this pins that the new redirect
    // goes through it rather than using the raw parameter.
    await seedBaseResume(testUser.id);

    await authedPage.goto("/onboarding?next=https%3A%2F%2Fevil.example%2Fphish");

    await authedPage.waitForURL("**/jobs");
  });
});
