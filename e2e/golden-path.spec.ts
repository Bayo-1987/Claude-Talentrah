/**
 * The golden path, named in build-prompt §11 and the plan doc's Verification
 * section, deferred through several passes because it needed an auth fixture
 * and a way to run without real model calls. Both now exist
 * (e2e/fixtures/authed.ts, src/lib/llm/stub-provider.ts).
 *
 * What is genuinely exercised: the real routes, Server Actions, credit
 * gating, ledger, and rendered UI. Only the model itself is swapped out.
 *
 * What is fixture-seeded rather than driven, and why — stated here so the
 * coverage claim isn't overread:
 *   - resume upload: needs a binary PDF/DOCX through a parser with an LLM
 *     fallback; covered by tests/resume/ instead.
 *   - buying credits: a real Paystack round-trip is out of scope for CI;
 *     the ledger write is identical, and everything after it is real.
 */
import {
  test,
  expect,
  admin,
  seedBaseResume,
  grantTestCredits,
  requireStubbedLlm,
} from "./fixtures/authed";
import { JD_MAX_CHARS } from "../src/lib/tailoring/types";

const SHORT_JD = `Senior Backend Engineer at Paystack.

We are looking for an engineer to build and operate payment APIs at scale.
You will work with Node.js, Postgres and distributed systems, and own
services end to end. Experience with high-volume transaction processing in
a regulated environment is a strong plus.`;

/** Comfortably over the cap, so the truncation notice must fire. */
const LONG_JD = SHORT_JD + "\n\n" + "Additional responsibilities and requirements. ".repeat(700);

test.describe("golden path", () => {
  // The journey runs two tailoring round-trips and roughly eight
  // navigations. The 30s project default expires mid-test, and because
  // fixture teardown then deletes the user while the body is still running,
  // it surfaces as an unrelated-looking null-profile error rather than a
  // clean timeout. Generous on purpose: with the model stubbed this
  // normally finishes in well under a minute.
  test.setTimeout(150_000);

  test("signed-in seeker can browse, apply, track, tailor, spend credits and refer", async ({
    authedPage: page,
    testUser,
  }) => {
    await requireStubbedLlm(page);
    await seedBaseResume(testUser.id);

    // --- Job feed -------------------------------------------------------
    await page.goto("/jobs");
    await expect(page.getByRole("heading", { level: 3 }).first()).toBeVisible();
    const jobCards = page.locator("form:has(button:text-is('Apply'))");
    expect(await jobCards.count(), "seeded internal jobs should be applyable").toBeGreaterThan(0);

    // --- Apply ----------------------------------------------------------
    await jobCards.first().getByRole("button", { name: "Apply", exact: true }).click();
    await page.waitForLoadState("networkidle");

    // The application row is the thing that matters, not the toast.
    const { data: applications } = await admin
      .from("applications")
      .select("id, stage")
      .eq("user_id", testUser.id);
    expect(applications, "applying should create an application row").toHaveLength(1);

    // --- Job Tracker ----------------------------------------------------
    await page.goto("/tracker");
    await expect(page.getByRole("heading", { name: "Job Tracker" })).toBeVisible();
    await expect(
      page.getByText("Nothing tracked yet", { exact: false }),
      "the applied job should appear in the tracker",
    ).toHaveCount(0);

    // --- Tailoring, first run: free trial --------------------------------
    await page.goto("/tailor");
    await page.locator("textarea").fill(SHORT_JD);
    await page.getByRole("button", { name: "Tailor my resume" }).click();

    await expect(page.getByText("ATS score")).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText("your free tailoring run", { exact: false }),
      "the first run should be the one-time free trial",
    ).toBeVisible();

    // Positive control for the truncation work: a JD under the cap must NOT
    // produce a notice. Without this, a notice that always rendered would
    // still satisfy the over-cap assertion below.
    await expect(
      page.getByText("that job description was shortened", { exact: false }),
      "a JD under the cap must not claim it was shortened",
    ).toHaveCount(0);
    await page.screenshot({ path: "playwright-report/jd-under-cap-no-notice.png", fullPage: false });

    // --- Credit spend ----------------------------------------------------
    // Second run: the free trial is used, so this draws on the balance.
    await grantTestCredits(testUser.id, 20);
    await page.goto("/billing");
    await expect(page.getByText("Your balance: 20 credits")).toBeVisible();

    await page.goto("/tailor");
    await page.locator("textarea").fill(SHORT_JD);
    await page.getByRole("button", { name: "Tailor my resume" }).click();
    await expect(page.getByText("credits used", { exact: false })).toBeVisible({ timeout: 30_000 });

    await page.goto("/billing");
    await expect(
      page.getByText("Your balance: 15 credits"),
      "a 5-credit tailoring run should leave 15 of 20",
    ).toBeVisible();

    // The ledger is the source of truth behind that number.
    const { data: ledger } = await admin
      .from("credit_ledger")
      .select("delta, reason")
      .eq("user_id", testUser.id)
      .eq("reason", "tailoring_run");
    expect(ledger, "the spend should be recorded in the ledger").toHaveLength(1);
    expect(ledger![0].delta).toBe(-5);

    // --- Referral --------------------------------------------------------
    await page.goto("/refer");
    const { data: profile } = await admin
      .from("profiles")
      .select("referral_code")
      .eq("id", testUser.id)
      .single();
    await expect(
      page.getByText(profile!.referral_code, { exact: false }),
      "the user's referral code should be on the page",
    ).toBeVisible();
  });

  test("an over-long JD renders a visible truncation notice", async ({
    authedPage: page,
    testUser,
  }) => {
    await requireStubbedLlm(page);
    await seedBaseResume(testUser.id);

    expect(LONG_JD.length, "fixture must actually exceed the cap").toBeGreaterThan(JD_MAX_CHARS);

    await page.goto("/tailor");
    await page.locator("textarea").fill(LONG_JD);

    // The length the BROWSER holds, not the length of the Node string. A
    // textarea normalises its value, so the two differ by a character here —
    // and it's the browser's value that is actually submitted, so that is
    // what the notice must report. Comparing against the Node string looked
    // right and failed for a reason that had nothing to do with the feature.
    const pastedChars = (await page.locator("textarea").inputValue()).length;
    expect(pastedChars).toBeGreaterThan(JD_MAX_CHARS);

    await page.getByRole("button", { name: "Tailor my resume" }).click();
    await expect(page.getByText("ATS score")).toBeVisible({ timeout: 30_000 });

    // Target the whole paragraph, not the bold lead-in: getByText resolves to
    // the DEEPEST element containing the phrase, which here is the <span>
    // wrapping only the headline — its textContent has none of the numbers.
    const notice = page.locator("p", { hasText: "that job description was shortened" });
    await expect(notice, "an over-cap JD must say so").toBeVisible();

    // The real character counts, not just the presence of a warning — a
    // notice with wrong numbers would be worse than none.
    // Matched digit-by-digit with a tolerant separator: the notice formats
    // via toLocaleString() in the BROWSER, whose locale needn't match the
    // Node process running this test, so a literal string compare here is a
    // false failure waiting to happen.
    const noticeText = (await notice.textContent()) ?? "";
    const numbers = [...noticeText.matchAll(/(\d[\d,.\s]*\d)/g)].map((m) =>
      Number(m[1].replace(/[^\d]/g, "")),
    );
    const [reportedOriginal, reportedUsed] = numbers;

    // The cap is asserted exactly — it's a constant, and a wrong value here
    // would be a real lie to the user.
    expect(reportedUsed, "notice must state the cap exactly").toBe(JD_MAX_CHARS);

    // The original length is asserted as "the size actually pasted, within a
    // character or two" rather than an exact match. It passes through Node
    // string -> fill() -> textarea value normalisation -> React state -> JSON
    // -> server, and those differ by one character. Pinning it exactly tested
    // that chain, not the feature; what matters is that the number is real
    // and not a placeholder or the cap repeated.
    expect(reportedOriginal, "notice must report a real original length").toBeGreaterThan(
      JD_MAX_CHARS,
    );
    expect(
      Math.abs(reportedOriginal - pastedChars),
      `notice reported ${reportedOriginal} but ~${pastedChars} was pasted`,
    ).toBeLessThanOrEqual(5);

    // It has to sit ABOVE the results — it changes how they should be read.
    // Compared by document order rather than bounding boxes: geometry is
    // layout- and viewport-dependent and returns null for anything scrolled
    // out of view, which made this assert about the window size instead of
    // the ordering it's meant to check.
    const noticeIsBeforeResults = await notice.evaluate((el) => {
      const ats = [...document.querySelectorAll("*")].find(
        (n) => n.children.length === 0 && n.textContent?.trim() === "ATS score",
      );
      if (!ats) return null;
      // DOCUMENT_POSITION_FOLLOWING === the other node comes after this one.
      return Boolean(el.compareDocumentPosition(ats) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(noticeIsBeforeResults, "the notice must appear above the results").toBe(true);

    // Visual record, uploaded by CI as part of the Playwright report.
    await page.screenshot({ path: "playwright-report/jd-truncation-notice.png", fullPage: false });
  });
});
