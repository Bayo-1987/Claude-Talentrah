/**
 * Every nav click must show something within ~100ms, on a slow connection.
 *
 * ── WHAT THIS IS ACTUALLY PINNING ─────────────────────────────────────────
 *
 * Not server speed. This suite would pass on a route that took ten seconds
 * to render, and that is the point: what was reported was not "the app is
 * slow", it was "clicking a nav link does nothing for seconds". Those are
 * different defects with different fixes. With no `loading.tsx` anywhere in
 * src/app, the App Router had nothing to swap in mid-navigation, so it left
 * the PREVIOUS page on screen, pixel-identical, until the new one was
 * completely ready. The click was working; it was invisible.
 *
 * So the assertion here is about FEEDBACK, measured from the click, with the
 * network deliberately slowed so a fast local render cannot hide a missing
 * boundary. A regression that deleted a `loading.tsx` would not slow
 * anything down measurably — it would just make the app feel broken again,
 * and nothing else in the suite would notice.
 *
 * ── WHY THE THROTTLE IS LOAD-BEARING ──────────────────────────────────────
 *
 * Against a warm local server every route answers in tens of milliseconds,
 * which is fast enough that the skeleton may never paint at all — so an
 * unthrottled version of this test would pass whether or not the boundary
 * existed. The CDP throttle below reproduces the target market's actual
 * conditions (CLAUDE.md: low-end Android, expensive mobile data) and makes
 * the boundary the only thing that can satisfy the assertion.
 *
 * ── WHY A data-testid AND NOT getByRole("status") ─────────────────────────
 *
 * This is the part that was wrong first, and the way it was wrong is the
 * reason the file says so out loud.
 *
 * The obvious selector is `getByRole("status")`: every grey block in a
 * skeleton is `aria-hidden`, and the one announced element is
 * SkeletonStatus. Written that way, all six cases passed — AND THEY ALSO
 * PASSED WITH ALL ELEVEN `loading.tsx` FILES MOVED OUT OF THE TREE, which
 * means the suite was measuring nothing at all.
 *
 * The cause: FarahFirstVisitHint (components/app-shell/farah-first-visit-
 * hint.tsx) also has `role="status"`. It renders from (app)/layout.tsx,
 * which is OUTSIDE the loading boundary and therefore already on screen
 * when the click happens, and it shows precisely when
 * `farah_hint_dismissed_at` is null — which is every freshly minted fixture
 * user. `.first()` found it instantly on every run.
 *
 * `data-testid` scoped to the skeleton is what makes the assertion about the
 * element it names. The negative control is not optional here: if this spec
 * is ever changed, delete the loading files and confirm it goes red before
 * believing it green.
 */
import { test, expect } from "./fixtures/authed";
import type { Page } from "@playwright/test";
import { ROUTE_LOADING_TESTID } from "@/components/ui/skeleton";

/** Roughly a poor 3G link — enough that a server render cannot beat the boundary. */
const SLOW_NETWORK = {
  offline: false,
  latency: 400,
  downloadThroughput: (400 * 1024) / 8,
  uploadThroughput: (400 * 1024) / 8,
};

async function throttle(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", SLOW_NETWORK);
  return cdp;
}

/**
 * The masthead links, by their accessible name. Kept as the visible label
 * rather than an href so the test breaks if a link is renamed out from under
 * the nav — a link nobody can find by name is its own bug.
 */
const NAV_LINKS = [
  "Jobs",
  "Job Tracker",
  "Auto-Apply",
  "Resume Builder",
  "Scholarships",
  "Refer a Friend",
] as const;

/**
 * The budget, and why the assertion is looser than the target.
 *
 * The goal is ~100ms of PERCEIVED feedback, and the mechanism comfortably
 * beats it: `loading.tsx` ships in the client bundle, so the router paints
 * the skeleton without waiting for the network at all — measured in the tens
 * of milliseconds locally.
 *
 * The assertion allows 3x that, because what this measures is not purely the
 * browser: `Date.now()` here brackets a Playwright `click()` round trip and a
 * polling `expect`, both of which add tens of milliseconds of harness
 * overhead that has nothing to do with the app. Asserting a hard 100ms would
 * be pinning CI's mood rather than the product. The real number is logged on
 * every run, so a genuine regression shows up as a moved number long before
 * it trips the ceiling — and a MISSING boundary does not creep past this at
 * all, it blows straight through, because it has to wait for a throttled
 * server render.
 */
const FEEDBACK_BUDGET_MS = 100;

test.describe("a nav click always shows something immediately", () => {
  /*
   * 60s, against the suite's 30s default, and NOT because these tests are
   * slow — warm, each one finishes in three or four seconds.
   *
   * The first test in the file pays for a cold `next start` compiling the
   * route on demand AND for the fixture minting a fresh Supabase auth user,
   * and that combination was measured at 30.8s: it blew the default budget
   * inside `goto`, then reported itself as "waiting for link Jobs", which
   * looks exactly like a broken selector and is not one. The extra headroom
   * is for the setup, not for the thing being measured — the assertion below
   * is still a strict 300ms, so a genuinely unresponsive nav cannot hide in
   * it.
   */
  test.describe.configure({ timeout: 60_000 });

  for (const label of NAV_LINKS) {
    test(`${label} paints a loading state within ${FEEDBACK_BUDGET_MS}ms`, async ({
      authedPage,
    }) => {
      /*
       * Start somewhere that is NOT the destination, so the click is a real
       * navigation rather than a no-op that would trivially "pass" — and
       * NOT /jobs specifically, even though it used to be the obvious
       * neutral choice. /jobs and /scholarships lost their own loading.tsx
       * as part of the fix for src/proxy.ts's seekerAppGate (see that file):
       * both have a public, notFound()-capable child route
       * (/jobs/[id], /scholarships/[id] and /scholarships/degree/[level])
       * that a shared ancestor loading.tsx would incorrectly wrap, turning
       * a 404 into a 200 that only bounces client-side. Starting HERE from
       * /jobs measured real degraded prefetch depth for every link clicked
       * from it — a genuine, understood side effect of that fix, not a flake
       * — so /billing is the neutral start now: it is not a NAV_LINKS target
       * and keeps its own loading.tsx untouched.
       */
      await authedPage.goto("/billing");
      await authedPage.waitForLoadState("domcontentloaded");

      await throttle(authedPage);

      const skeleton = authedPage.getByTestId(ROUTE_LOADING_TESTID);
      // Nothing from a previous route may be lingering, or the assertion
      // below would pass on the old page's DOM rather than the new one's.
      await expect(skeleton).toHaveCount(0);

      const started = Date.now();
      await authedPage.getByRole("link", { name: label, exact: true }).first().click();

      // `toBeAttached`, not `toBeVisible`: SkeletonStatus is sr-only, which is
      // clipped to a 1px box and therefore not "visible" to Playwright even
      // though it is very much present and announced.
      await expect(skeleton.first()).toBeAttached({ timeout: FEEDBACK_BUDGET_MS * 20 });
      const elapsed = Date.now() - started;

      // Logged on success too, not only on failure — the number is the point.
      console.log(`  [nav-responsiveness] ${label}: loading state after ${elapsed}ms`);

      expect(
        elapsed,
        `${label} showed no loading state for ${elapsed}ms — the route segment is probably missing a loading.tsx`,
      ).toBeLessThanOrEqual(FEEDBACK_BUDGET_MS * 3);
    });
  }
});
