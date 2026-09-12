import { test, expect, type Page } from "@playwright/test";

/**
 * A second-or-later "Ask Farah" click, once a conversation already has
 * content, silently showed the PREVIOUS job's answer with nothing marking
 * it stale — reproduced directly on production: clicking "Ask Farah" on a
 * Data Scientist (Fraud) listing after already asking about a Senior
 * Product Manager role kept the panel showing the PM answer, unlabelled,
 * about a role it no longer concerned.
 *
 * `farah-panel-transcript.test.tsx` already pins the STATIC initial-render
 * cases via `renderToStaticMarkup` (its own header explains why: the real
 * seed only ever arrives through `onFarahJobSeed`'s window-event listener,
 * registered inside a `useEffect` that never runs under that renderer). The
 * actual bug — a SECOND live event arriving after a conversation is already
 * open — can only be exercised with a real browser, which is what this file
 * is for.
 *
 * Real generation calls happen twice here (once per job asked about), each
 * of which can take up to ~90s against a live provider — same reasoning as
 * every other real-call test in this repo that bumps past the 30s default.
 */

const DEMO_PASSWORD = process.env.DEMO_PASSWORD;

if (process.env.CI && !DEMO_PASSWORD) {
  throw new Error("farah-panel-job-context-switch spec cannot run in CI: DEMO_PASSWORD is not set");
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo@talentrah.dev");
  await page.getByLabel("Password", { exact: true }).fill(DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/jobs");
}

/**
 * The reply streams in (send-latency-4/#359), so "Farah is thinking…"
 * disappears at the FIRST token, not at completion — reading a message's
 * text right after that would risk capturing a partial answer that keeps
 * growing underneath the assertion. `pending` (unlike `awaitingFirstToken`)
 * only clears in `send`'s `finally`, once the whole stream has been read and
 * the reply's real id has been swapped in — the input's `disabled` state is
 * the one visible signal tied to that, so wait on it instead.
 */
async function waitForReplyToFinish(page: Page) {
  await expect(page.getByPlaceholder("Ask me anything…")).toBeEnabled({ timeout: 120_000 });
}

test.describe("switching which job the docked panel is seeded for", () => {
  test.skip(!DEMO_PASSWORD, "DEMO_PASSWORD is not set — see scripts/seed.ts");

  test("clicking Ask Farah on a second job, mid-conversation, marks the switch and stays askable — without losing the first answer", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await login(page);

    const cards = page.getByTestId("job-card");
    await expect(cards.first()).toBeVisible();
    const cardCount = await cards.count();
    expect(cardCount, "this test needs at least two jobs on the feed").toBeGreaterThanOrEqual(2);

    // Two cards with genuinely different titles — the feed can (and does)
    // list the same title from more than one company, which would make
    // "job A's title is still visible" and "the divider names job B"
    // trivially true of each other rather than a real distinction.
    const cardA = cards.nth(0);
    const titleA = (await cardA.locator("h3 a").first().innerText()).trim();
    let cardB = cards.nth(1);
    let titleB = (await cardB.locator("h3 a").first().innerText()).trim();
    for (let i = 2; i < cardCount && titleA === titleB; i++) {
      cardB = cards.nth(i);
      titleB = (await cardB.locator("h3 a").first().innerText()).trim();
    }
    expect(titleA, "precondition: found two cards with different titles").not.toBe(titleB);
    const jobIdB = (await cardB.locator("h3 a").first().getAttribute("href"))?.replace("/jobs/", "");

    const panel = page.getByTestId("farah-panel");
    const timelineMessages = panel.getByTestId("farah-message");
    const dividers = panel.getByTestId("job-seed-divider");

    // ── First click, into a pristine panel — the empty-state path, must
    // still work exactly as before this fix. ──────────────────────────────
    await cardA.getByRole("button", { name: "Ask Farah" }).click();
    await expect(panel.getByText(titleA)).toBeVisible();
    await expect(dividers).toHaveCount(0); // no earlier job to switch away from yet
    const askFitButton = panel.getByRole("button", { name: "Why is this a good fit for me?" });
    await expect(askFitButton).toBeVisible();

    // Ask it for real — this is what makes messages.length > 0, the
    // precondition for the bug.
    await askFitButton.click();
    await waitForReplyToFinish(page);
    await expect(timelineMessages).toHaveCount(2); // the question, then Farah's answer
    const farahReplyToA = await timelineMessages.nth(1).innerText();
    expect(farahReplyToA.length).toBeGreaterThan(0);

    // The question itself is now a plain, already-asked turn — not a
    // clickable starter any more.
    await expect(panel.getByRole("button", { name: "Why is this a good fit for me?" })).toHaveCount(0);

    // ── THE BUG: click Ask Farah on a DIFFERENT job, mid-conversation. ────
    await cardB.getByRole("button", { name: "Ask Farah" }).click();

    // The switch is now visibly marked, naming the new job — and the first
    // conversation is untouched: same two turns, still there, still first.
    await expect(dividers).toHaveCount(1);
    await expect(dividers.first()).toContainText(`Now looking at: ${titleB}`);
    await expect(timelineMessages).toHaveCount(2);
    expect(await timelineMessages.nth(1).innerText()).toBe(farahReplyToA);

    // A fresh, real way to ask about the new job — exactly one instance,
    // freshly clickable, and pointing at job B specifically (not a stale
    // reference to job A).
    const newAskFitButton = panel.getByRole("button", { name: "Why is this a good fit for me?" });
    await expect(newAskFitButton).toHaveCount(1);
    await expect(newAskFitButton).toBeEnabled();
    const tailorLinkForB = panel.getByRole("link", { name: "Tailor my resume for this job →" });
    await expect(tailorLinkForB).toHaveAttribute("href", `/tailor?jobId=${jobIdB}`);

    // Actually ask about job B through the fresh starter.
    await newAskFitButton.click();
    await waitForReplyToFinish(page);

    // Final shape: job A's two turns, unchanged and in place, THEN the
    // divider, THEN job B's two new turns — nothing lost, nothing reordered.
    await expect(timelineMessages).toHaveCount(4);
    expect(await timelineMessages.nth(1).innerText()).toBe(farahReplyToA);
    const order = await page.evaluate(() => {
      const nodes = document.querySelectorAll(
        '[data-testid="farah-message"], [data-testid="job-seed-divider"]',
      );
      return [...nodes].map((el) => (el as HTMLElement).dataset.testid);
    });
    expect(order).toEqual([
      "farah-message",
      "farah-message",
      "job-seed-divider",
      "farah-message",
      "farah-message",
    ]);
  });
});
