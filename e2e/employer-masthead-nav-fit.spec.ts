import { test, expect, type Page } from "@playwright/test";

/**
 * The employer masthead must never wrap ANY of its text onto two lines —
 * two separate, independently-discovered bugs, both fixed here.
 *
 * ── BUG 1: THE RIGHT-HAND GROUP (send-442) ─────────────────────────────────
 *
 * "Looking for work?" only appeared at `min-[900px]`, and that threshold was
 * chosen without checking it against the LEFT nav, which was already showing
 * from 640px at the time (see below — that breakpoint has since moved too).
 * Between 900 and roughly 1132px the two competed for space and "Looking for
 * work?" and "Sign out" wrapped onto two lines — a real git-stash A/B test
 * confirmed this predates any recent change. A sweep in 4-40px steps, signed
 * in as the demo org owner (so the org-initials badge is present — the
 * widest right-hand-group state), narrowed the range:
 *
 *     width   wraps?
 *      900     yes
 *     1024     yes
 *     1132     yes
 *     1136     no    <- crossover
 *     1160     no
 *
 * Confirmed identical under `next build && next start`, not just `next dev`.
 *
 * The fix moved the reveal breakpoint from 900 to 1200 (real margin over the
 * measured 1136 crossover, not a bare "it passed once" number — see the
 * component's own comment) and added `whitespace-nowrap` to both elements, so
 * a future regression overflows visibly instead of silently reflowing.
 *
 * ── BUG 2: THE LEFT NAV (send-388) ──────────────────────────────────────────
 *
 * `NAV_LINKS`' breakpoint (`min-[640px]:flex`) was measured once against
 * THREE links; Analytics (0128) and Talent Directory (0135) brought it to
 * five and nobody re-derived it. A prior fix (PR #388) measured a real
 * crossover and raised this breakpoint, but was written against the Sunbird
 * design system and closed unmerged, moot, the same day Sunbird was reverted
 * back to Editorial (PR #395) — its diagnosis was right, its patch no longer
 * applied. Re-measured fresh against current Editorial markup, via a Range
 * over each link's TEXT (not the link's own box, which stays `min-h-10`
 * whether the label wraps or not):
 *
 *     width   wraps?
 *      640     yes
 *      850     no    <- an isolated gap, not a real threshold
 *      900     yes
 *      985     yes
 *      990     no    <- first width in a continuous clean run
 *     1200     no
 *
 * Non-monotonic below 990 — wraps and un-wraps across nearby widths rather
 * than a clean step function — which is exactly why this fix does not pick
 * the first clean width it found. Moved the breakpoint to 1200, matching
 * bug 1's own fix rather than introducing a third almost-matching magic
 * number, for 210px of real margin over the measured 985px crossover.
 *
 * ── WHY THIS CHECKS WRAPPING DIRECTLY RATHER THAN A GAP ───────────────────
 *
 * masthead-nav-fit.spec.ts (the seeker equivalent) measures the gap between
 * the nav's painted text and the right-hand group, because that bug was an
 * OVERLAP with the document never overflowing. Both bugs here are different:
 * nothing overlaps anything — flex simply shrinks an element below its
 * content width and the browser wraps the text inside. A gap measurement
 * would not have caught either one; checking whether each element's own
 * text occupies more than one line does.
 */

const DEMO_PASSWORD = process.env.DEMO_PASSWORD;

if (process.env.CI && !DEMO_PASSWORD) {
  throw new Error("employer-masthead-nav-fit spec cannot run in CI: DEMO_PASSWORD is not set");
}

/**
 * Shared by both the left nav and the right-hand group as of send-388 — see
 * this file's own header for why that is a deliberate consolidation, not a
 * coincidence. Below this, the left nav's 5 links AND "Looking for work?"
 * are hidden entirely (both live in the hamburger disclosure below 640, and
 * are unreachable in the bar between 640 and this breakpoint — a
 * pre-existing gap neither fix introduced, see employer-masthead.tsx's own
 * comments). At and above it, everything must render on one line.
 */
const REVEAL_BREAKPOINT = 1200;

/** The real danger zone bug 1 occupied, plus the boundary either side. */
const RIGHT_GROUP_WIDTHS = [
  900, 960, 1024, 1080, 1120, 1132, 1136, 1160, REVEAL_BREAKPOINT - 1, REVEAL_BREAKPOINT, 1280,
];

/**
 * The real danger zone bug 2 occupied — non-monotonic, so this sweeps every
 * width the investigation found wrapped OR clean in that zone, not just the
 * two endpoints, plus the boundary either side.
 */
const LEFT_NAV_WIDTHS = [
  640, 700, 768, 800, 850, 900, 950, 975, 985, 990, 1024, 1150, REVEAL_BREAKPOINT - 1, REVEAL_BREAKPOINT, 1280,
];

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo@talentrah.dev");
  await page.getByLabel("Password", { exact: true }).fill(DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/jobs");
}

test.describe("the employer masthead fits where it is shown", () => {
  test.skip(!DEMO_PASSWORD, "DEMO_PASSWORD is not set — see scripts/seed.ts");

  test("\"Looking for work?\" and \"Sign out\" never wrap, across the real danger zone (send-442)", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await login(page);
    await page.goto("/employer/jobs");
    await expect(page.getByTestId("employer-masthead")).toBeVisible();

    for (const width of RIGHT_GROUP_WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(150);

      const m = await page.evaluate(() => {
        function isWrapped(el: Element | null) {
          if (!el) return null;
          const r = document.createRange();
          r.selectNodeContents(el);
          return r.getClientRects().length > 1;
        }
        const lookingLink = [...document.querySelectorAll("a")].find(
          (a) => a.textContent?.trim() === "Looking for work?",
        );
        const signOutBtn = [...document.querySelectorAll("button")].find(
          (b) => b.textContent?.trim() === "Sign out",
        );
        return {
          lookingVisible: !!(lookingLink && (lookingLink as HTMLElement).offsetParent !== null),
          lookingWrapped: isWrapped(lookingLink ?? null),
          signOutWrapped: isWrapped(signOutBtn ?? null),
        };
      });

      // "Sign out" carries no breakpoint of its own — it renders at every
      // width — so it is always checked. "Looking for work?" is gated by a
      // reveal breakpoint (see employer-masthead.tsx's own comment): BEFORE
      // this fix that breakpoint was 900, so a width in this sweep could be
      // above the OLD 900px threshold and below this test's own
      // REVEAL_BREAKPOINT constant while still rendering the chip — wrapped.
      // Gating this check on REVEAL_BREAKPOINT (rather than on whatever the
      // element actually reports) would have skipped exactly the range the
      // original bug lived in, which is what an earlier draft of this test
      // did — it passed against the unfixed component for the wrong reason,
      // by never looking at the width range that was actually broken. This
      // checks wrap state whenever the element is genuinely visible, however
      // it got there.
      expect(m.signOutWrapped, `"Sign out" wrapped onto two lines at ${width}px`).toBe(false);
      if (m.lookingVisible) {
        expect(
          m.lookingWrapped,
          `"Looking for work?" wrapped onto two lines at ${width}px`,
        ).toBe(false);
      }

      if (width >= REVEAL_BREAKPOINT) {
        expect(
          m.lookingVisible,
          `"Looking for work?" should be visible at ${width}px, at or above the ${REVEAL_BREAKPOINT}px reveal breakpoint`,
        ).toBe(true);
      }
    }
  });

  test("no left-nav link wraps onto a second line, across the real danger zone (send-388)", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await login(page);
    await page.goto("/employer/jobs");
    await expect(page.getByTestId("employer-masthead")).toBeVisible();

    for (const width of LEFT_NAV_WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(150);

      const m = await page.evaluate(() => {
        const nav = document.querySelector('[data-testid="employer-masthead"] nav');
        if (!nav || getComputedStyle(nav).display === "none") {
          return { navShown: false as const };
        }
        // A Range over each link's TEXT, not the link's own bounding box —
        // the box carries `min-h-10` (40px) whether or not the label inside
        // it wraps, so it cannot distinguish a wrapped label from a single
        // line one. This is what actually changes: ~21px for one line,
        // ~42.75px for two.
        const wrapped = [...nav.querySelectorAll("a")]
          .map((a) => {
            const r = document.createRange();
            r.selectNodeContents(a);
            return { label: a.textContent?.trim() ?? "", height: r.getBoundingClientRect().height };
          })
          .filter((l) => l.height > 30);
        return { navShown: true as const, wrapped };
      });

      if (width < REVEAL_BREAKPOINT) {
        expect(
          m.navShown,
          `the nav bar renders at ${width}px, below the ${REVEAL_BREAKPOINT}px breakpoint it is meant to be hidden until`,
        ).toBe(false);
        continue;
      }

      expect(m.navShown, `the nav bar is hidden at ${width}px, at or above the reveal breakpoint`).toBe(
        true,
      );
      if (m.navShown) {
        expect(
          m.wrapped,
          `these nav links wrapped onto a second line at ${width}px: ${JSON.stringify(m.wrapped)}`,
        ).toEqual([]);
      }
    }
  });
});
