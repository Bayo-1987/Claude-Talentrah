import { test, expect } from "@playwright/test";

/**
 * Two things a seeker steers by on the feed: how contested a job is, and
 * whether the controls are still there after scrolling.
 *
 * APPLICANT COUNTS ARE ONLY HONEST FOR INTERNAL POSTINGS. An external one is
 * advertised and applied to on someone else's site; the only applications we
 * can see are the fraction that routed through Talentrah and said so. Printing
 * that as "3 applicants" would be a number with no relationship to the truth.
 * 0059 enforces the internal-only rule in SQL so a caller cannot get it wrong,
 * and the card says "Applicant count unavailable" for the rest.
 *
 * STICKINESS IS MEASURED, NOT EYEBALLED. Two of the three elements worked on
 * the first attempt and the third — the masthead — scrolled away to
 * top:-2500 while looking entirely correct in the source. Only
 * getBoundingClientRect after a real scroll tells them apart.
 */
const DEMO_PASSWORD = process.env.DEMO_PASSWORD;

if (process.env.CI && !DEMO_PASSWORD) {
  // A skip must not read as a pass on the summary line.
  throw new Error("feed-chrome spec cannot run in CI: DEMO_PASSWORD is not set");
}

/** The masthead is 68px of content plus a 2.5px bottom border. */
const MASTHEAD_BOTTOM = 71;

test.use({ viewport: { width: 1280, height: 900 } });

test.beforeEach(async ({ page }) => {
  test.skip(!DEMO_PASSWORD, "DEMO_PASSWORD is not set — see scripts/seed.ts");
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo@talentrah.dev");
  await page.getByLabel("Password").fill(DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/jobs");
});

test("every card states an applicant count or says it cannot", async ({ page }) => {
  // No card may be silent about it. Omitting the line at zero would make its
  // absence ambiguous with the unknown case, which is the whole distinction.
  const lines = await page.evaluate(() =>
    [...document.querySelectorAll("p, span")]
      .map((el) => (el as HTMLElement).innerText?.trim() ?? "")
      .filter((t) => /^Posted .+ ago · /.test(t)),
  );

  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) {
    expect(line).toMatch(/· (\d+ applicants?|Applicant count unavailable)$/);
  }
});

test("external postings never claim a count", async ({ page }) => {
  const externalLines = await page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll("h3").forEach((h) => {
      if (!h.textContent?.includes("sourced externally")) return;
      const card = h.closest("div[class*='border-[1.5px]']");
      const posted = [...(card?.querySelectorAll("span") ?? [])]
        .map((s) => (s as HTMLElement).innerText?.trim() ?? "")
        .find((t) => /^Posted .+ ago · /.test(t));
      if (posted) out.push(posted);
    });
    return out;
  });

  expect(externalLines.length).toBeGreaterThan(0);
  for (const line of externalLines) {
    expect(line).toContain("Applicant count unavailable");
    expect(line).not.toMatch(/\d+ applicants?/);
  }
});

test("a saved job is not an applicant", async ({ page }) => {
  /*
   * The seeded board has an internal posting with an `applications` row at
   * stage `saved` and nothing further — a bookmark. It must read 0, not 1.
   * Counting bookmarks as applicants is the specific lie the number's value
   * depends on not telling, and the only way to catch it is a posting where
   * the two differ.
   */
  await page.goto("/jobs?tab=recent");
  // By heading text, not by link role: card titles are plain text on this
  // branch. A role selector silently matched nothing and turned the most
  // valuable assertion in this file into a skip.
  const card = page.locator("div[class*='border-[1.5px]']").filter({
    has: page.getByRole("heading", { name: /Customer Success Associate/ }),
  });
  expect(await card.count(), "the seeded internal posting should be on the recent board").toBeGreaterThan(0);
  await expect(card.first()).toContainText("0 applicants");

  // And a posting that really does have an applicant reads 1 — otherwise "0"
  // could just mean the count never arrives.
  const applied = page.locator("div[class*='border-[1.5px]']").filter({
    has: page.getByRole("heading", { name: /Backend Engineer/ }),
  });
  if ((await applied.count()) > 0) {
    await expect(applied.first()).toContainText("1 applicant");
  }
});

test("the masthead, filter header and Farah panel all survive a long scroll", async ({ page }) => {
  const measure = () =>
    page.evaluate(() => {
      const box = (sel: string) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
      };
      return {
        masthead: box('[data-testid="masthead-band"]'),
        header: box('[data-testid="feed-header"]'),
        panel: box('[data-testid="farah-panel"]'),
        scrollY: Math.round(window.scrollY),
      };
    });

  const before = await measure();
  expect(before.masthead, "the masthead should exist").not.toBeNull();
  expect(before.header, "the filter header should exist").not.toBeNull();
  expect(before.panel, "the Farah panel should exist").not.toBeNull();

  await page.mouse.wheel(0, 3000);
  await page.waitForTimeout(600);
  const after = await measure();

  // A real scroll happened — otherwise everything "staying put" proves nothing.
  expect(after.scrollY).toBeGreaterThan(1000);

  // The masthead pins to the very top. This is the one that silently failed:
  // its wrapper was exactly its own height, so sticky had nowhere to travel.
  expect(after.masthead!.top).toBe(0);

  // The other two pin just under it, and must not have drifted up the page.
  expect(after.header!.top).toBeGreaterThanOrEqual(0);
  expect(after.header!.top).toBeLessThanOrEqual(MASTHEAD_BOTTOM);
  expect(after.panel!.top).toBeGreaterThanOrEqual(0);
  expect(after.panel!.top).toBeLessThanOrEqual(MASTHEAD_BOTTOM);
});

test("the filter header is flush at rest, not 32px adrift", async ({ page }) => {
  /*
   * (app)/layout.tsx wraps the page in py-8, so without the `-mt-8 pt-8` pull
   * the header's box begins 32px below the masthead. It still LOCKS at the
   * same place once stuck — which is why the first two versions of this test
   * passed with the pull removed. Measured:
   *
   *                       at rest   scrolled
   *     with the pull       gap 0    gap -2
   *     without             gap 32   gap -2
   *
   * So the symptom is entirely at rest and in the travel: a visible strip of
   * paper under the masthead, and a 32px jump as the header catches up. The
   * scrolled state cannot see it, and asserting there proved nothing twice.
   *
   * UPDATED when the header became `position: fixed`. The `-mt-8` pull is
   * still what this guards — the spacer inherits it, and without it the whole
   * column would start 32px low. What changed is that at-rest and scrolled are
   * now the SAME measurement rather than two: sticky sat at its flow position
   * (gap 0) until scrolling pushed it to its 68px threshold (gap -2); fixed is
   * pinned at 68 throughout, so the gap is -2 in both states. The range below
   * already allowed that, which is why it is a range and not an equality.
   */
  const gapAtRest = await page.evaluate(() => {
    const m = document.querySelector('[data-testid="masthead-band"]') as HTMLElement;
    const h = document.querySelector('[data-testid="feed-header"]') as HTMLElement;
    return Math.round(h.getBoundingClientRect().top - m.getBoundingClientRect().bottom);
  });
  expect(gapAtRest).toBeLessThanOrEqual(2);
  expect(gapAtRest).toBeGreaterThanOrEqual(-4);

  // And once stuck it tucks under the masthead rather than leaving a seam.
  await page.mouse.wheel(0, 3000);
  await page.waitForTimeout(600);

  const stuck = await page.evaluate(() => {
    const m = document.querySelector('[data-testid="masthead-band"]') as HTMLElement;
    const h = document.querySelector('[data-testid="feed-header"]') as HTMLElement;
    const y = Math.round(m.getBoundingClientRect().bottom) + 4;
    const el = document.elementFromPoint(400, y) as HTMLElement | null;
    return {
      gap: Math.round(h.getBoundingClientRect().top - m.getBoundingClientRect().bottom),
      // Whatever is painted just below the masthead must belong to one of the
      // two sticky regions — a job card there is content bleeding through.
      covered: !!el && (h.contains(el) || m.contains(el)),
    };
  });
  expect(stuck.gap).toBeLessThanOrEqual(0);
  expect(stuck.covered).toBe(true);

  /*
   * And it is actually OPAQUE.
   *
   * `elementFromPoint` hit-tests a transparent element exactly like a painted
   * one, so the `covered` check above passes with `bg-paper` removed while
   * cards scroll visibly through the header. The computed background is the
   * only thing that tells them apart — a sticky header you can see through is
   * worse than no sticky header at all.
   */
  const background = await page.evaluate(() => {
    const h = document.querySelector('[data-testid="feed-header"]') as HTMLElement;
    return getComputedStyle(h).backgroundColor;
  });
  expect(background).not.toBe("transparent");
  expect(background).not.toMatch(/rgba\([^)]*,\s*0\s*\)/);
});

test("the shell is sticky everywhere, not only on the feed", async ({ page }) => {
  // The masthead and panel live in (app)/layout.tsx, so this is a change to
  // every page under it — /tracker has no filter header of its own and must
  // still hold the other two.
  await page.goto("/tracker");
  await page.mouse.wheel(0, 1500);
  await page.waitForTimeout(600);

  const after = await page.evaluate(() => {
    const box = (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      return el ? Math.round(el.getBoundingClientRect().top) : null;
    };
    return { masthead: box('[data-testid="masthead-band"]'), panel: box('[data-testid="farah-panel"]'), scrollY: Math.round(window.scrollY) };
  });

  expect(after.scrollY).toBeGreaterThan(400);
  expect(after.masthead).toBe(0);
  expect(after.panel).toBeLessThanOrEqual(MASTHEAD_BOTTOM);
  expect(after.panel).toBeGreaterThanOrEqual(0);
});
