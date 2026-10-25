import { test, expect, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { clearDemoFarahThread, demoFarahHintDismissedAt, resetDemoFarahHint, setDemoFarahHintDismissedAt } from "./fixtures/farah-thread";
import { waitForWorkerControl } from "./support/pwa";

/**
 * FARAH-JOB-CTX-1. Clicking "Ask Farah" on a job card hands that job to the docked Farah panel. The owner's report: the options appeared but the panel showed no visible change: the older conversation stayed on screen,
 * nothing scrolled, nothing said that something had happened. The new block was added at the END of the panel's 320px scroller, below the fold of it, and nothing scrolled it into view.
 *
 * NO MODEL IS CALLED. The saved conversation is faked at the network (/api/farah/history answers a long, recent thread, so the panel restores it) and every request to /api/farah/chat is refused and counted: the click must send
 * nothing, which is also what keeps the reader's free messages. Nothing here needs a key. Set SHOT_DIR to a folder to keep before/after screenshots of the panel (no key or personal data is on screen: the demo account is fixture data).
 */

const DEMO_PASSWORD = process.env.DEMO_PASSWORD;
const SHOT_DIR = process.env.SHOT_DIR;
const FREE_LEFT = 2;

if (process.env.CI && !DEMO_PASSWORD) {
  throw new Error("farah-job-context-visible spec cannot run in CI: DEMO_PASSWORD is not set");
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo@talentrah.dev");
  await page.getByLabel("Password", { exact: true }).fill(DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/jobs");
}

/** Five exchanges of a few lines each, dated now: taller than the panel's scroller, and recent enough that the panel restores it on load (under 24 hours). */
function longThread() {
  const now = Date.now();
  const messages = [];
  for (let i = 0; i < 5; i++) {
    messages.push({ id: `fake-u-${i}`, role: "user", content: `Question ${i + 1} about my search: how should I prepare for the next round with a longer note so that it wraps over several lines in the narrow column?`, created_at: new Date(now - (12 - i * 2) * 60_000).toISOString() });
    messages.push({ id: `fake-f-${i}`, role: "farah", content: `Answer ${i + 1}. Start with the role's three main requirements, write one honest example for each from your own work, and keep each to two sentences you can say out loud without notes.`, created_at: new Date(now - (11 - i * 2) * 60_000).toISOString() });
  }
  return messages;
}

async function arrange(page: Page, opts: { thread: boolean }) {
  const chatRequests: string[] = [];
  await page.route("**/api/farah/history", (route) =>
    route.fulfill({ json: { messages: opts.thread ? longThread() : [], freeMessagesRemaining: FREE_LEFT, nextFreeMessageAt: null, hasUnreadNotification: false } }),
  );
  await page.route("**/api/farah/chat", (route) => {
    chatRequests.push(route.request().postData() ?? "");
    return route.abort();
  });
  // Every scrollTo on an element (the panel scrolls its own scroller), with the behavior asked for, and every window scroll, so the tests can see what was asked for as well as what happened.
  await page.addInitScript(() => {
    const w = window as unknown as { __scrolls: Array<{ target: string; behavior: string | undefined }> };
    w.__scrolls = [];
    const original = Element.prototype.scrollTo;
    Element.prototype.scrollTo = function (this: Element, ...args: unknown[]) {
      const opts = args[0] as ScrollToOptions | undefined;
      w.__scrolls.push({ target: (this as HTMLElement).dataset?.testid === "farah-panel-scroller" ? "scroller" : this.tagName, behavior: typeof opts === "object" ? opts.behavior : undefined });
      return (original as (...a: unknown[]) => void).apply(this, args);
    } as typeof Element.prototype.scrollTo;
  });
  return chatRequests;
}

const scrolls = (page: Page) => page.evaluate(() => (window as unknown as { __scrolls: Array<{ target: string; behavior?: string }> }).__scrolls);

async function shot(locator: Locator, name: string) {
  if (!SHOT_DIR) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await locator.screenshot({ path: join(SHOT_DIR, `${name}.png`) });
}

/** What the reader's screen shows right now (the viewport, not the whole page): the narrow-screen evidence. */
async function shotViewport(page: Page, name: string) {
  if (!SHOT_DIR) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: join(SHOT_DIR, `${name}.png`) });
}

async function cardTitle(card: Locator) {
  return (await card.locator("h3 a").first().innerText()).trim();
}

/**
 * What the reader can see of the new block: the chip and the first option, each inside the visible part of the panel's scroller (not clipped above or below it). The whole block is taller than the 320px scroller
 * (divider, chip, label, opener, four options), so what must be seen is its top: the job and where to start.
 */
async function seenInScroller(block: Locator) {
  return block.evaluate((el) => {
    const scroller = el.parentElement!;
    const s = scroller.getBoundingClientRect();
    const inside = (node: Element | null) => {
      if (!node) return { found: false, top: 0, bottomGap: 0 };
      const b = node.getBoundingClientRect();
      return { found: true, top: b.top - s.top, bottomGap: s.bottom - b.bottom };
    };
    return { chip: inside(el.querySelector('[data-testid="job-context-chip"]')), firstOption: inside(el.querySelector("[data-job-option]")), scrollerOverflows: scroller.scrollHeight > scroller.clientHeight + 1 };
  });
}

async function expectSeen(block: Locator, timeout = 5_000) {
  await expect(async () => {
    const g = await seenInScroller(block);
    for (const [name, part] of [["chip", g.chip], ["first option", g.firstOption]] as const) {
      expect(part.found, `${name} not found`).toBe(true);
      expect(part.top, `the ${name} starts above the visible part of the scroller`).toBeGreaterThanOrEqual(-1);
      expect(part.bottomGap, `the ${name} runs past the bottom of the visible part of the scroller`).toBeGreaterThanOrEqual(-1);
    }
  }).toPass({ timeout });
}

/** All four options inside the visible part of the panel's scroller (the block must fit, not only its top). */
async function expectAllOptionsSeen(block: Locator, timeout = 5_000) {
  await expect(async () => {
    const rects = await block.evaluate((el) => {
      const s = el.parentElement!.getBoundingClientRect();
      return [...el.querySelectorAll("[data-job-option]")].map((o) => {
        const r = o.getBoundingClientRect();
        return { top: r.top - s.top, bottomGap: s.bottom - r.bottom };
      });
    });
    expect(rects).toHaveLength(4);
    for (const [i, r] of rects.entries()) {
      expect(r.top, `option ${i + 1} starts above the visible part of the scroller`).toBeGreaterThanOrEqual(-1);
      expect(r.bottomGap, `option ${i + 1} runs past the bottom of the visible part of the scroller`).toBeGreaterThanOrEqual(-1);
    }
  }).toPass({ timeout });
}

/** Dispatches a beforeinstallprompt-shaped event (Chromium never offers one in automation), as e2e/pwa-install-strip.spec.ts does. */
async function firePrompt(page: Page) {
  await page.evaluate(() => {
    const ev = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt: () => Promise.resolve(), userChoice: Promise.resolve({ outcome: "accepted" as const }) });
    window.dispatchEvent(ev);
  });
}

const liveRegion = (panel: Locator) => panel.locator('p[role="status"][aria-live="polite"]');

async function freeMessageText(panel: Locator) {
  return (await panel.locator("#farah-allowance-note").innerText().catch(() => "")).trim();
}

test.describe("Ask Farah on a job makes the panel visibly respond", () => {
  test.skip(!DEMO_PASSWORD, "DEMO_PASSWORD is not set — see scripts/seed.ts");
  test.beforeEach(async () => {
    await clearDemoFarahThread();
    // The hint is on the page only while the demo profile's flag is null, and the pair of install-strip tests dismisses it. Nothing else puts it back, so every test starts from "never seen it".
    await resetDemoFarahHint();
  });

  // The flag the demo account is left in is what every later spec in the shard runs against, and the install strip waits while the hint is in the page. This file's tests dismiss the hint (the pair of install-strip tests clicks "Got it") and the dismissal is
  // an un-awaited Server Action, so before this fix the end state was whatever that race left (null on fast machines, dismissed when a write landed). It is now always "never dismissed", which is also what the seeded account starts as and what the unmodified file left on every local run.
  test.afterAll(async () => {
    await setDemoFarahHintDismissedAt(null);
    expect(await demoFarahHintDismissedAt(), "the hint flag must be left null so the file's end state is deterministic").toBeNull();
  });

  test("mid-conversation, on a wide screen: the new block is scrolled into view with the job's chip, labelled options and a divider; focus and the announcement follow; nothing is sent", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const chatRequests = await arrange(page, { thread: true });
    await login(page);
    const panel = page.getByTestId("farah-panel");
    const messages = panel.getByTestId("farah-message");
    await expect(messages).toHaveCount(10);
    const allowanceBefore = await freeMessageText(panel);
    expect(allowanceBefore, "the panel must be showing the free-message allowance for this test to mean anything").toContain(String(FREE_LEFT));

    const card = page.getByTestId("job-card").first();
    await expect(card).toBeVisible();
    const title = await cardTitle(card);
    await shot(panel, "wide-1-before-click");

    await card.getByRole("button", { name: "Ask Farah" }).click();

    // (a) the chip and the first option are on screen inside the scroller, and the scroller did move (the thread above the block is taller than the scroller)
    const block = panel.getByTestId("job-seed-block");
    await expect(block).toHaveCount(1);
    await expect(block).toBeVisible();
    expect((await seenInScroller(block)).scrollerOverflows, "the thread should overflow the scroller").toBe(true);
    await expectSeen(block);
    // ...and it was the panel's own scroller that was scrolled, smoothly when motion is allowed
    const calls = await scrolls(page);
    expect(calls.find((c) => c.target === "scroller")?.behavior).toBe("smooth");

    // (b) the chip names the job and the company, at the top of the block (under the divider)
    const chip = block.getByTestId("job-context-chip");
    await expect(chip).toContainText(title);
    await expect(chip).toContainText(/\S/);
    // (d) the divider separates it from the older conversation
    await expect(block.getByTestId("job-seed-divider")).toContainText(`Asking about: ${title}`);
    // (c) labelled options directly under the chip, wording unchanged
    const group = block.getByRole("group", { name: "Choose what to do with this job" });
    await expect(group.getByRole("button")).toHaveText(["Why is this a good fit for me?", "What resume tips do you have for this role?"]);
    await expect(group.getByRole("link")).toHaveText(["Tailor my resume for this job →", "Draft an intro message for this job →"]);
    // (e) keyboard focus is on the first option
    await expect(group.getByRole("button", { name: "Why is this a good fit for me?" })).toBeFocused();
    // (f) a polite live region says Farah has the job
    await expect(liveRegion(panel)).toContainText(`Farah has ${title}`);
    await expect(liveRegion(panel)).toContainText(/nothing has been sent/i);

    // nothing was sent, nothing was spent, and the thread above is untouched
    await page.waitForTimeout(500);
    expect(chatRequests, "the click sent a chat message").toHaveLength(0);
    expect(await freeMessageText(panel)).toBe(allowanceBefore);
    await expect(messages).toHaveCount(10);
    await shot(panel, "wide-2-after-click");
  });

  test("a reader who asked for reduced motion gets the same view without animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await arrange(page, { thread: true });
    await login(page);
    const panel = page.getByTestId("farah-panel");
    await expect(panel.getByTestId("farah-message")).toHaveCount(10);
    await page.getByTestId("job-card").first().getByRole("button", { name: "Ask Farah" }).click();
    const block = panel.getByTestId("job-seed-block");
    await expect(block).toBeVisible();
    const calls = await scrolls(page);
    expect(calls.find((c) => c.target === "scroller")?.behavior).toBe("auto");
    await expectSeen(block);
  });

  test("on a pristine panel the job replaces the greeting: chip, label and options, no divider, focus on the first option, nothing sent", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const chatRequests = await arrange(page, { thread: false });
    await login(page);
    const panel = page.getByTestId("farah-panel");
    await expect(panel.getByText(/Hi Demo|Hi /).first()).toBeVisible();
    const card = page.getByTestId("job-card").first();
    const title = await cardTitle(card);
    await shot(panel, "pristine-1-before-click");
    await card.getByRole("button", { name: "Ask Farah" }).click();
    const block = panel.getByTestId("job-seed-block");
    await expect(block.getByTestId("job-context-chip")).toContainText(title);
    await expect(block.getByTestId("job-seed-divider")).toHaveCount(0);
    await expect(block.getByRole("button", { name: "Why is this a good fit for me?" })).toBeFocused();
    await expect(liveRegion(panel)).toContainText(`Farah has ${title}`);
    await page.waitForTimeout(300);
    expect(chatRequests).toHaveLength(0);
    await shot(panel, "pristine-2-after-click");
  });

  test("the same job clicked again is not silent: the block is brought back into view and focus returns to its first option, without a second divider", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const chatRequests = await arrange(page, { thread: true });
    await login(page);
    const panel = page.getByTestId("farah-panel");
    await expect(panel.getByTestId("farah-message")).toHaveCount(10);
    const card = page.getByTestId("job-card").first();
    const title = await cardTitle(card);
    await card.getByRole("button", { name: "Ask Farah" }).click();
    const block = panel.getByTestId("job-seed-block");
    await expect(block).toBeVisible();
    // the reader scrolls the panel's conversation back to the top and the focus goes elsewhere
    await panel.getByTestId("farah-panel-scroller").evaluate((el) => (el.scrollTop = 0));
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect(async () => {
      const g = await seenInScroller(block);
      expect(g.chip.top < 0 || g.chip.bottomGap < 0, "the block should be out of sight before the second click").toBe(true);
    }).toPass({ timeout: 3_000 });
    await card.getByRole("button", { name: "Ask Farah" }).click();
    await expect(panel.getByTestId("job-seed-block")).toHaveCount(1);
    await expect(panel.getByTestId("job-seed-divider")).toHaveCount(1);
    await expectSeen(block);
    await expect(block.getByRole("button", { name: "Why is this a good fit for me?" })).toBeFocused();
    await expect(liveRegion(panel)).toContainText(`Farah has ${title}`);
    expect(chatRequests).toHaveLength(0);
  });

  test("a second, different job adds a second divider and block, and is the one brought into view", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const chatRequests = await arrange(page, { thread: true });
    await login(page);
    const panel = page.getByTestId("farah-panel");
    await expect(panel.getByTestId("farah-message")).toHaveCount(10);
    const cards = page.getByTestId("job-card");
    await expect(cards.first()).toBeVisible();
    expect(await cards.count(), "the feed needs two jobs").toBeGreaterThanOrEqual(2);
    // two different postings (the feed can list the same title twice, so the check is on the posting, not the title)
    const hrefA = await cards.nth(0).locator("h3 a").first().getAttribute("href");
    const hrefB = await cards.nth(1).locator("h3 a").first().getAttribute("href");
    expect(hrefA).not.toBe(hrefB);
    const titleB = await cardTitle(cards.nth(1));
    await cards.nth(0).getByRole("button", { name: "Ask Farah" }).click();
    await expect(panel.getByTestId("job-seed-block")).toHaveCount(1);
    await cards.nth(1).getByRole("button", { name: "Ask Farah" }).click();
    await expect(panel.getByTestId("job-seed-block")).toHaveCount(2);
    const latest = panel.getByTestId("job-seed-block").last();
    await expect(latest.getByTestId("job-seed-divider")).toContainText(`Asking about: ${titleB}`);
    await expect(latest.getByTestId("job-context-chip")).toContainText(titleB);
    await expect(latest.getByRole("button", { name: "Why is this a good fit for me?" })).toBeFocused();
    await expectSeen(latest);
    expect(chatRequests).toHaveLength(0);
  });

  for (const thread of [true, false]) {
    test(`wide screen, ${thread ? "mid-conversation" : "pristine panel"}: all four options are fully inside the scroller after the click (the fourth, 'Draft an intro message', is not below the fold)`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await arrange(page, { thread });
      await login(page);
      const panel = page.getByTestId("farah-panel");
      if (thread) await expect(panel.getByTestId("farah-message")).toHaveCount(10);
      await page.getByTestId("job-card").first().getByRole("button", { name: "Ask Farah" }).click();
      const block = panel.getByTestId("job-seed-block");
      await expect(block).toBeVisible();
      await expectAllOptionsSeen(block);
    });
  }

  /*
   * LAUNCHER PLAN PR-2. Below 760px there is no first-visit hint (the launcher announces itself) and the panel is the bottom sheet. The old phone tests here were about the hint stepping
   * aside for a job and about the install strip waiting for it; with no hint on a phone, what is left to prove is: the strip is NOT held back, "Ask Farah" on a card opens the sheet, the seed
   * arrives after the sheet is open (so focus lands on the first option), and nothing fixed covers an option.
   */
  for (const [w, h] of [[390, 844], [390, 667]] as const) {
    test(`phone ${w}x${h}: the strip is not held back; Ask Farah opens the sheet with the job on screen, focus on its first option, and nothing covering an option`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.addInitScript(() => localStorage.setItem("talentrah-cookie-consent", "accepted"));
      const chatRequests = await arrange(page, { thread: true });
      await login(page);
      const panel = page.getByTestId("farah-panel");
      await waitForWorkerControl(page);
      const strip = page.getByTestId("install-strip");
      await expect(page.getByTestId("farah-first-visit-hint"), "no hint on a phone").toHaveCount(0);
      await firePrompt(page);
      await expect(strip, "with no hint in the page the strip is not held back").toBeVisible();
      await page.getByRole("button", { name: "Not now" }).click();

      const sheet = page.getByTestId("farah-sheet");
      await expect(sheet).toHaveAttribute("data-sheet", "closed");
      const card = page.getByTestId("job-card").first();
      await card.scrollIntoViewIfNeeded();
      await card.getByRole("button", { name: "Ask Farah" }).click();
      await expect(sheet).toHaveAttribute("data-sheet", "open");
      const block = panel.getByTestId("job-seed-block");
      await expect(block).toBeVisible();
      await expectSeen(block);
      await expect(block.getByRole("button", { name: "Why is this a good fit for me?" })).toBeFocused();
      // nothing fixed sits over an option: each option is inside the viewport and is the topmost thing at its centre
      const state = await page.evaluate(() =>
        [...document.querySelectorAll("[data-job-option]")].map((el) => {
          const r = el.getBoundingClientRect();
          const top = document.elementFromPoint(r.left + r.width / 2, Math.min(Math.max(r.top + r.height / 2, 0), window.innerHeight - 1));
          return { label: (el as HTMLElement).innerText.slice(0, 20), inViewport: r.top >= 0 && r.bottom <= window.innerHeight, covered: !!top && !el.contains(top) && !top.contains(el) };
        }),
      );
      expect(state).toHaveLength(4);
      for (const o of state) {
        expect(o.inViewport, `${o.label} is outside the viewport`).toBe(true);
        expect(o.covered, `${o.label} is covered`).toBe(false);
      }
      expect(chatRequests).toHaveLength(0);
    });
  }

  // Moved here from the end of the two phone tests (S3's FIX-FARAH-HINT-FLAKE-1) unchanged: a phone has no first-visit hint any more (the launcher announces itself), so the dismissal runs at a width that has one.
  test("dismissing the hint properly lets the strip come", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.addInitScript(() => localStorage.setItem("talentrah-cookie-consent", "accepted"));
    await arrange(page, { thread: true });
    await login(page);
    await waitForWorkerControl(page);
    const strip = page.getByTestId("install-strip");
      // dismissing the hint properly (its own button) still lets the strip come, as before
      await page.reload();
      await expect(page.getByTestId("farah-first-visit-hint")).toBeVisible();
      await page.getByRole("button", { name: "Got it" }).click();
      await firePrompt(page);
      await expect(strip).toBeVisible();
      // The dismissal is an optimistic, fire-and-forget Server Action: the box goes on the click and the profile is written afterwards. Ending the test here let that write land during the NEXT test's page load, which then
      // found no hint (the 390x667 test, main run 40227282842). Wait for the write, as e2e/farah-first-visit-hint.spec.ts does.
      await expect(async () => {
        expect(await demoFarahHintDismissedAt(), "the dismissal was never persisted").not.toBeNull();
      }).toPass({ timeout: 10_000 });
    });

  test("guard: the reset puts a dismissed demo account back to never-seen, so the hint renders on a wide screen", async ({ page }) => {
    await setDemoFarahHintDismissedAt(new Date().toISOString());
    expect(await demoFarahHintDismissedAt(), "the arrangement: dismissed").not.toBeNull();
    await resetDemoFarahHint();
    expect(await demoFarahHintDismissedAt(), "the helper did not clear the flag").toBeNull();
    await page.setViewportSize({ width: 1024, height: 900 });
    await arrange(page, { thread: true });
    await login(page);
    await expect(page.getByTestId("farah-first-visit-hint")).toBeVisible();
  });

  test("guard: the flag helper refuses to pass silently when Supabase refuses the update or no row matches", async () => {
    const refused = { from: () => ({ update: () => ({ eq: () => ({ select: async () => ({ data: null, error: { message: "refused" } }) }) }) }) } as unknown as Parameters<typeof resetDemoFarahHint>[0];
    await expect(resetDemoFarahHint(refused)).rejects.toThrow(/refused/);
    const noRow = { from: () => ({ update: () => ({ eq: () => ({ select: async () => ({ data: [], error: null }) }) }) }) } as unknown as Parameters<typeof resetDemoFarahHint>[0];
    await expect(resetDemoFarahHint(noRow)).rejects.toThrow(/expected exactly 1/);
  });

  test("on a narrow screen the sheet opens and the new block is on screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const chatRequests = await arrange(page, { thread: true });
    await login(page);
    const panel = page.getByTestId("farah-panel");
    await expect(panel.getByTestId("farah-message")).toHaveCount(10);
    const card = page.getByTestId("job-card").first();
    const title = await cardTitle(card);
    await card.scrollIntoViewIfNeeded();
    await expect(page.getByTestId("farah-sheet"), "the panel starts as the closed sheet on a phone").toHaveAttribute("data-sheet", "closed");
    await shotViewport(page, "narrow-1-before-click");
    await card.getByRole("button", { name: "Ask Farah" }).click();
    const block = panel.getByTestId("job-seed-block");
    await expect(block).toBeVisible();
    // the sheet was opened by the click, and the chip and first option are on the screen (the viewport), not only inside the scroller
    await expectSeen(block, 8_000);
    await expect(async () => {
      const r = await block.evaluate((el) => {
        const part = (sel: string) => {
          const b = el.querySelector(sel)!.getBoundingClientRect();
          return { top: b.top, bottom: b.bottom };
        };
        return { chip: part('[data-testid="job-context-chip"]'), option: part("[data-job-option]"), vh: window.innerHeight };
      });
      for (const p of [r.chip, r.option]) {
        expect(p.top, "above the viewport").toBeGreaterThanOrEqual(-1);
        expect(p.bottom, "below the viewport").toBeLessThanOrEqual(r.vh + 1);
      }
    }).toPass({ timeout: 8_000 });
    await expect(block.getByTestId("job-context-chip")).toContainText(title);
    await expect(block.getByRole("button", { name: "Why is this a good fit for me?" })).toBeFocused();
    expect(chatRequests).toHaveLength(0);
    await page.waitForTimeout(600); // let the smooth scroll settle before the picture
    await shotViewport(page, "narrow-2-after-click");
  });
});
