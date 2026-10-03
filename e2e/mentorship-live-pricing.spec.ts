/**
 * send-393 — /mentorship's signed-out metadata description and its own
 * "Pricing" paragraph both hardcoded "from ₦5,000"/"up to ₦100,000+"
 * (send-385), neither ever checked against a mentor a visitor could
 * actually book. Queried directly against production: exactly two
 * approved, non-paused mentors exist, min ₦15,000 / max ₦20,000 — nowhere
 * near either number.
 *
 * Fixed by src/lib/mentorship/public-price-range.ts's
 * getApprovedMentorPriceRangeNgn(), read live at request time by both the
 * metadata and the page body. This file follows the same live-constant-
 * matching pattern as tests/referrals/referrals.test.ts: it reads the real
 * value from the database independently (its own query, not a copy of the
 * production code's query) and asserts the rendered page agrees with it —
 * never a hardcoded "15000" that could drift the exact way "5000" did.
 *
 * Three things this file proves, not just asserts:
 * 1. The description/paragraph genuinely reflect WHATEVER is live right
 *    now, including the zero-qualifying-mentors case (this repo's local
 *    dev project currently has approved mentors, but every one has a null
 *    base_price_ngn — a real, present instance of the fallback path, not a
 *    hypothetical).
 * 2. It is actually LIVE, not cached or computed once: inserting a fixture
 *    mentor priced below the current floor changes the rendered price on
 *    the next request, and removing it reverts the page — the same
 *    "prove the test catches the bug" standard this repo holds itself to
 *    elsewhere (reverting the fix locally must make this fail).
 * 3. The signed-in branch and the page's overall title are unaffected.
 */
import { test, expect, admin } from "./fixtures/authed";
import type { Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

/**
 * `(list)`'s own loading.tsx renders a generic skeleton — including the
 * AUTHENTICATED page's own H1 text ("Talk to someone who's done it.") —
 * regardless of auth state, by design (it streams before the async page
 * component has resolved who's visiting; see that file's own header
 * comment). Reading `body.innerText()` immediately after `goto()` can catch
 * that skeleton instead of the real signed-out landing, which shares no
 * text with it. Wait for the real page's own H1 first, the same way a
 * human waiting for the page to finish loading would.
 */
async function waitForPublicLandingLoaded(page: Page) {
  await expect(
    page.getByRole("heading", { name: "Real career mentors, for the moments Farah can't coach you through alone." }),
  ).toBeVisible();
}

/** Same filter as getApprovedMentorPriceRangeNgn's own query, expressed independently. */
async function queryLiveApprovedPriceRange(): Promise<{ minNgn: number; maxNgn: number } | null> {
  const { data, error } = await admin
    .from("mentor_profiles")
    .select("base_price_ngn")
    .eq("status", "approved")
    .eq("self_paused", false)
    .not("base_price_ngn", "is", null)
    .gt("base_price_ngn", 0);
  if (error) throw error;
  const prices = (data ?? [])
    .map((r) => r.base_price_ngn)
    .filter((p): p is number => p !== null);
  if (prices.length === 0) return null;
  return { minNgn: Math.min(...prices), maxNgn: Math.max(...prices) };
}

/**
 * What the page must say for a live range, written out here on purpose and NOT by importing the app's own formatter: a test that
 * checks the helper against itself passes when the helper is wrong. One amount when the bounds are equal, "from X to Y" otherwise.
 */
const naira = (n: number) => `₦${n.toLocaleString("en-NG")}`;
const SAME_AMOUNT_TWICE = /(₦[\d,]+) to \1(?![\d,])/;
function expectedMetadataClause(r: { minNgn: number; maxNgn: number }): string {
  return r.minNgn === r.maxNgn ? `, ${naira(r.minNgn)} per session` : `, from ${naira(r.minNgn)} to ${naira(r.maxNgn)} per session`;
}
function expectedPriceSentence(r: { minNgn: number; maxNgn: number }): string {
  return r.minNgn === r.maxNgn ? `Right now, a session costs ${naira(r.minNgn)}.` : `Right now, sessions cost from ${naira(r.minNgn)} to ${naira(r.maxNgn)}.`;
}

test.describe("send-393: /mentorship pricing claims match live mentor_profiles data", () => {
  test("metadata description's price clause matches (or correctly omits) the real current floor", async ({
    page,
  }) => {
    const live = await queryLiveApprovedPriceRange();

    await page.goto("/mentorship");
    const description = await page.locator('meta[name="description"]').first().getAttribute("content");
    expect(description).toBeTruthy();

    // Never the stale figures this replaces, regardless of live state.
    expect(description).not.toContain("₦5,000");
    expect(description).not.toContain("from ₦5,000");

    if (live !== null) {
      // One amount when min equals max, "from ₦X to ₦Y" otherwise: never "₦X to ₦X".
      expect(description).toContain(expectedMetadataClause(live));
      expect(description).not.toMatch(SAME_AMOUNT_TWICE);
    } else {
      // The honest fallback: no price clause at all, not a guessed number.
      expect(description).not.toMatch(/₦\d/);
      expect(description).toContain("across Nigeria and Africa.");
    }
  });

  test("the page's own Pricing paragraph matches (or correctly omits) the real current range", async ({ page }) => {
    const live = await queryLiveApprovedPriceRange();

    await page.goto("/mentorship");
    await waitForPublicLandingLoaded(page);
    const bodyText = await page.locator("body").innerText();

    expect(bodyText).not.toContain("₦5,000");
    expect(bodyText).not.toContain("₦100,000");

    if (live !== null) {
      expect(bodyText).toContain(expectedPriceSentence(live));
      expect(bodyText).not.toMatch(SAME_AMOUNT_TWICE);
    } else {
      expect(bodyText).toContain("Mentors set their own rates depending on their experience");
    }
  });

  test("is genuinely LIVE: a new lower-priced approved mentor changes the rendered floor on the next request", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    // Below send-385's stale ₦5,000, so this cannot pass by re-displaying that number by coincidence.
    // A fixed, literal fixture price (₦1,111), so the assertions below name the exact text a visitor reads rather than recomputing it.
    // It must be the lowest price live; the check below fails loudly, naming this assumption, if a real mentor is priced at or under it.
    const fixturePriceNgn = 1111;

    const domain = `${randomUUID().slice(0, 12)}.talentrah.test`;
    const email = `mentor-pricing-${randomUUID()}@${domain}`;
    const { data: user, error: userErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (userErr || !user) throw new Error(`fixture user creation failed: ${userErr?.message}`);

    try {
      const { error: mpErr } = await admin.from("mentor_profiles").insert({
        user_id: user.user.id,
        status: "approved",
        self_paused: false,
        base_price_ngn: fixturePriceNgn,
        bio: "send-393 live-pricing fixture",
      });
      if (mpErr) throw new Error(`fixture mentor_profiles insert failed: ${mpErr.message}`);

      const after = await queryLiveApprovedPriceRange();
      expect(after?.minNgn, "fixture did not become the live floor — test setup assumption broke").toBe(
        fixturePriceNgn,
      );

      await page.goto("/mentorship");
      const description = await page.locator('meta[name="description"]').first().getAttribute("content");
      expect(description).toContain("₦1,111");
      expect(description).toContain(after!.maxNgn === 1111 ? ", ₦1,111 per session" : ", from ₦1,111 to ");
      expect(description).not.toMatch(SAME_AMOUNT_TWICE);

      await waitForPublicLandingLoaded(page);
      const bodyText = await page.locator("body").innerText();
      expect(bodyText).toContain("₦1,111");
      expect(bodyText).toContain(after!.maxNgn === 1111 ? "Right now, a session costs ₦1,111." : "Right now, sessions cost from ₦1,111 to ");
      expect(bodyText).not.toMatch(SAME_AMOUNT_TWICE);
    } finally {
      const { error: deleteErr } = await admin.auth.admin.deleteUser(user.user.id);
      if (deleteErr) throw new Error(`cleanup failed, fixture user ${user.user.id} left behind: ${deleteErr.message}`);
    }

    // Reverted: the page no longer shows the fixture's price.
    await page.goto("/mentorship");
    const revertedDescription = await page.locator('meta[name="description"]').first().getAttribute("content");
    expect(revertedDescription).not.toContain("₦1,111");
  });
});

test.describe("send-393 regression: the rest of generateMetadata() is unchanged", () => {
  test("signed-out title is unchanged", async ({ page }) => {
    await page.goto("/mentorship");
    expect(await page.title()).toBe("Mentorship for Job Seekers in Nigeria & Africa — Talentrah");
  });

  test("a signed-in visitor still gets the original plain title, unaffected by the price fix", async ({
    authedPage,
  }) => {
    await authedPage.goto("/mentorship");
    expect(await authedPage.title()).toBe("Mentorship — Talentrah");
  });
});
