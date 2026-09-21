import { test, expect, type Page } from "@playwright/test";

/**
 * The employer masthead's right-hand group ("Looking for work?", the org
 * badge, "Sign out") must never wrap onto two lines.
 *
 * ── THE BUG THIS EXISTS FOR (send-442) ────────────────────────────────────
 *
 * "Looking for work?" only appeared at `min-[900px]`, and that threshold was
 * chosen without checking it against the LEFT nav, which is already showing
 * from 640px (see employer-masthead.tsx's own comment on that number). Between
 * 900 and roughly 1132px the two competed for space and "Looking for work?"
 * and "Sign out" wrapped onto two lines — a real git-stash A/B test confirmed
 * this predates any recent change. A sweep in 4-40px steps, signed in as the
 * demo org owner (so the org-initials badge is present — the widest
 * right-hand-group state), narrowed the range:
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
 * ── WHY THIS CHECKS WRAPPING DIRECTLY RATHER THAN A GAP ───────────────────
 *
 * masthead-nav-fit.spec.ts (the seeker equivalent) measures the gap between
 * the nav's painted text and the right-hand group, because that bug was an
 * OVERLAP with the document never overflowing. This bug is different: the
 * elements involved (a `bg-rust-soft` link and a `Sign out` button) do not
 * overlap anything — flex simply shrank them below their content width and
 * the browser wrapped the text inside. A gap measurement would not have
 * caught it; checking whether each element's own text occupies more than one
 * line does.
 */

const DEMO_PASSWORD = process.env.DEMO_PASSWORD;

if (process.env.CI && !DEMO_PASSWORD) {
  throw new Error("employer-masthead-nav-fit spec cannot run in CI: DEMO_PASSWORD is not set");
}

/**
 * Below this, "Looking for work?" is hidden entirely (it lives in the
 * hamburger disclosure below 640, and is unreachable in the bar between 640
 * and this breakpoint — a pre-existing gap this fix did not introduce, see
 * employer-masthead.tsx's own comment). At and above it, both elements must
 * render on one line.
 */
const REVEAL_BREAKPOINT = 1200;

/** The real danger zone this bug occupied, plus the boundary either side. */
const WIDTHS = [900, 960, 1024, 1080, 1120, 1132, 1136, 1160, REVEAL_BREAKPOINT - 1, REVEAL_BREAKPOINT, 1280];

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo@talentrah.dev");
  await page.getByLabel("Password", { exact: true }).fill(DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/jobs");
}

test.describe("the employer masthead's right-hand group fits where it is shown", () => {
  test.skip(!DEMO_PASSWORD, "DEMO_PASSWORD is not set — see scripts/seed.ts");

  test("\"Looking for work?\" and \"Sign out\" never wrap, across the real danger zone", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await login(page);
    await page.goto("/employer/jobs");
    await expect(page.getByTestId("employer-masthead")).toBeVisible();

    for (const width of WIDTHS) {
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
});
