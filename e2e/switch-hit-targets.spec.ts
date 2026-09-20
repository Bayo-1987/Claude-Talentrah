/**
 * send-380 — all 5 `role="switch"` toggles share one copy-pasted button
 * class list: a visible 26×46px track whose clickable region used to be
 * exactly that box, well under CLAUDE.md's own ">=40x40px, even small ones"
 * rule for interactive elements.
 *
 * The fix (src/components/jobs/auto-apply-toggle.tsx,
 * src/components/referrals/leaderboard-opt-in.tsx,
 * src/app/(app)/mentorship/apply/self-pause-toggle.tsx,
 * src/app/(app)/mentorship/apply/reviews-verifications-toggle.tsx,
 * src/app/(app)/talent-directory/verify/opt-in-toggle.tsx) adds an invisible
 * `::before` pseudo-element (`before:absolute before:-inset-[7px]
 * before:content-['']`) extending the real hit target to 40×60px without
 * touching the visible track — `rounded-full` and the 26×46px drawn pill
 * are correct as-is (CLAUDE.md's own circular-affordance exception).
 *
 * A NEW FILE rather than an extension of e2e/hit-targets.spec.ts: that spec's
 * own approach — measure `getBoundingClientRect()` and assert >=40x40 — is
 * exactly the wrong test here. These switches are DELIBERATELY kept at a
 * visible 26×46px; the fix is an invisible clickable area layered on top, so
 * the only way to prove it is a real click at a point outside the visible
 * box, not a bounding-box measurement (which would just fail forever on a
 * control that's supposed to stay visually small). Different property,
 * different assertion, so a separate file rather than force-fitting into the
 * file whose own header explains why IT measures bounding boxes.
 *
 * Each case does three things: (1) confirms the visible track is UNCHANGED
 * at 26×46px — the fix must not have grown the drawn control; (2) clicks a
 * real point 5px outside that visible box (comfortably inside the 7px
 * invisible extension) and confirms the switch actually toggles; (3) clicks
 * a point 5px further out again (12px from the edge, outside the 7px
 * extension) and confirms THAT one does NOT toggle it — proving the test
 * isn't vacuously passing by hitting some larger ancestor container.
 *
 * send-424 — this file's own historical CI flake (the Auto-Apply toggle
 * case, /jobs, failed intermittently: first documented around PR #488, then
 * three more times in one day, 2026-09-20, across unrelated PRs). TWO real
 * issues compounded, found in this order:
 *
 * 1. Every test computed the switch's click coordinates ONCE (`probeSwitch`)
 *    and reused that single snapshot for BOTH clicks. If the page's layout
 *    shifts between that probe and either click, the cached coordinate goes
 *    stale. Fixed with `clickSwitchPoint`, which re-probes immediately
 *    before every click rather than reusing a snapshot across an await
 *    boundary.
 *
 * 2. Even with (1) fixed, real CI runs kept failing at the exact same
 *    assertion — "must toggle it", "expected true, received false" —
 *    meaning the click was landing correctly but `aria-checked` still read
 *    the OLD value immediately afterward. This file's old `ariaChecked`
 *    helper was a single, non-retrying `page.evaluate` read taken
 *    immediately after the click, asserting on a value React updates
 *    asynchronously (`AutoApplyToggle`'s onClick runs
 *    `startTransition(async () => { setOptimisticEnabled(!enabled); await
 *    setAutoApplyEnabledAction(!enabled); })` — an optimistic update inside
 *    a transition, with the awaited action's own comment noting it's
 *    "several database round-trips"). A one-shot read racing an
 *    asynchronously-updated attribute is a structural bug independent of
 *    the exact scheduling reason: a busier CI runner is more likely to
 *    still be mid-update at read time than a quiet local machine is.
 *
 *    WORTH BEING HONEST ABOUT WHAT'S PROVEN HERE: an attempt to reproduce
 *    the exact race locally, by intercepting the Server Action's own
 *    request via `page.route` and artificially delaying it 2s, did NOT
 *    reproduce a stale read — the optimistic value was already "true"
 *    immediately after the click regardless of that delay, meaning
 *    `useOptimistic` genuinely does commit fast, independent of network
 *    latency, at least under this specific reproduction. So the PRECISE
 *    scheduling mechanism behind the two real CI failures (both at this
 *    exact assertion, both with this exact "expected true, received false"
 *    signature, both occurring only AFTER the coordinate fix in (1) was
 *    already applied) isn't conclusively pinned down here — it may be
 *    CI-runner resource contention slowing React's own paint/reconciliation
 *    more generally, rather than specifically the network round-trip.
 *
 *    The fix doesn't depend on knowing the exact mechanism: asserting
 *    through Playwright's own auto-retrying `expect(locator)
 *    .toHaveAttribute(...)` instead of a one-shot read is the correct way
 *    to check an asynchronously-updated DOM attribute regardless of WHY the
 *    update might be delayed. This is a genuine fix, not a longer
 *    timeout — it waits for the real condition rather than sampling once
 *    and hoping enough time has already passed.
 */
import { test, expect, admin } from "./fixtures/authed";
import type { Page } from "@playwright/test";

interface SwitchProbe {
  visible: { w: number; h: number };
  insideExtension: { x: number; y: number };
  outsideExtension: { x: number; y: number };
}

function switchLocator(page: Page, ariaLabel: string) {
  return page.locator(`[role="switch"][aria-label="${ariaLabel}"]`);
}

/**
 * Asserts `aria-checked` via Playwright's own auto-retrying
 * `toHaveAttribute` — polls until it matches (or the default timeout
 * elapses) rather than reading the DOM once and comparing synchronously.
 * See this file's own header, item 2, for why a one-shot read is the wrong
 * tool against an optimistic React transition.
 */
async function expectChecked(
  page: Page,
  ariaLabel: string,
  checked: "true" | "false",
  message?: string,
) {
  await expect(switchLocator(page, ariaLabel), message).toHaveAttribute("aria-checked", checked);
}

/** All measurements/points are computed from the real rendered box, not
 * hardcoded — the fix's own -7px inset is read back from computed style
 * rather than assumed, so a future change to that value doesn't silently
 * make this test click the wrong spot. */
async function probeSwitch(page: Page, ariaLabel: string): Promise<SwitchProbe> {
  return page.evaluate((label) => {
    const btn = document.querySelector<HTMLElement>(`[role="switch"][aria-label="${label}"]`);
    if (!btn) throw new Error(`switch not found: ${label}`);
    const rect = btn.getBoundingClientRect();
    // Read the fix's own `-7px` inset back from computed style so a future
    // change to that value doesn't silently make this test click the wrong
    // spot — but fall back to the SAME assumed 7px when there's no `::before`
    // at all (the pre-fix shape), rather than propagating a NaN into the
    // click coordinates below: a NaN click is a Playwright protocol error,
    // not a clean "expected true, got false" failure, and this repro is
    // meant to demonstrate the latter.
    const parsedInset = parseFloat(getComputedStyle(btn, "::before").inset);
    const extension = Number.isFinite(parsedInset) ? Math.abs(parsedInset) : 7;
    const cx = rect.left + rect.width / 2;
    return {
      visible: { w: Math.round(rect.width * 10) / 10, h: Math.round(rect.height * 10) / 10 },
      insideExtension: { x: cx, y: rect.top - Math.max(extension - 2, 1) },
      outsideExtension: { x: cx, y: rect.top - extension - 5 },
    };
  }, ariaLabel);
}

/**
 * send-424 — re-probes immediately before EVERY click rather than reusing a
 * snapshot across an await boundary, so a layout shift between two clicks
 * can't produce a stale-coordinate click. See this file's own header, item
 * 1, and the REGRESSION test below, which proves this directly by injecting
 * a real shift.
 */
async function clickSwitchPoint(
  page: Page,
  ariaLabel: string,
  which: "insideExtension" | "outsideExtension",
): Promise<void> {
  const probe = await probeSwitch(page, ariaLabel);
  await page.mouse.click(probe[which].x, probe[which].y);
}

test.describe("switch toggle hit targets extend beyond the visible 26x46px track", () => {
  test("Auto-Apply toggle (job feed)", async ({ authedPage }) => {
    await authedPage.goto("/jobs");
    const label = "Auto-Apply";
    await authedPage.locator(`[role="switch"][aria-label="${label}"]`).scrollIntoViewIfNeeded();

    const before = await probeSwitch(authedPage, label);
    expect(before.visible).toEqual({ w: 46, h: 26 });
    await expectChecked(authedPage, label, "false");

    await clickSwitchPoint(authedPage, label, "outsideExtension");
    await expectChecked(authedPage, label, "false", "a click past the extended zone must NOT toggle it");

    await clickSwitchPoint(authedPage, label, "insideExtension");
    await expectChecked(
      authedPage,
      label,
      "true",
      "a click inside the extended zone, outside the visible pill, must toggle it",
    );

    const after = await probeSwitch(authedPage, label);
    expect(after.visible, "the visible track must not have grown").toEqual({ w: 46, h: 26 });
  });

  test(
    "REGRESSION (send-424): a layout shift between probing and clicking must not produce a " +
      "stale-coordinate click",
    async ({ authedPage }) => {
      await authedPage.goto("/jobs");
      const label = "Auto-Apply";
      await authedPage.locator(`[role="switch"][aria-label="${label}"]`).scrollIntoViewIfNeeded();

      const before = await probeSwitch(authedPage, label);
      expect(before.visible).toEqual({ w: 46, h: 26 });
      await expectChecked(authedPage, label, "false");

      // Simulate exactly the class of shift a job feed with async,
      // match-scored cards streaming in produces — content arriving above
      // the toggle and pushing it down, after the FIRST probe already ran.
      await authedPage.evaluate(() => {
        const spacer = document.createElement("div");
        spacer.style.height = "80px";
        spacer.id = "e2e-injected-shift";
        document.body.prepend(spacer);
      });

      // Prove the shift is real and would genuinely break the OLD
      // (probe-once, reuse-the-coordinate) pattern: at the position the
      // FIRST probe recorded, the switch is no longer there.
      const staleCoordinateStillHitsTheSwitch = await authedPage.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return el?.getAttribute("role") === "switch";
      }, before.insideExtension);
      expect(
        staleCoordinateStillHitsTheSwitch,
        "the injected shift didn't move the target — this run isn't exercising the real race",
      ).toBe(false);

      // The fix under test: clickSwitchPoint re-probes immediately before
      // clicking, so it lands correctly despite the shift that already
      // invalidated `before`'s own coordinates.
      await clickSwitchPoint(authedPage, label, "outsideExtension");
      await expectChecked(authedPage, label, "false", "a click past the extended zone must NOT toggle it");

      await clickSwitchPoint(authedPage, label, "insideExtension");
      await expectChecked(
        authedPage,
        label,
        "true",
        "a fresh-probed click must toggle it despite the earlier shift",
      );

      await authedPage.evaluate(() => document.getElementById("e2e-injected-shift")?.remove());
    },
  );

  test("referral leaderboard opt-in toggle", async ({ authedPage }) => {
    await authedPage.goto("/refer");
    const label = "Appear on the referral leaderboard";
    await authedPage.locator(`[role="switch"][aria-label="${label}"]`).scrollIntoViewIfNeeded();

    const before = await probeSwitch(authedPage, label);
    expect(before.visible).toEqual({ w: 46, h: 26 });
    await expectChecked(authedPage, label, "false");

    await clickSwitchPoint(authedPage, label, "outsideExtension");
    await expectChecked(authedPage, label, "false");

    await clickSwitchPoint(authedPage, label, "insideExtension");
    await expectChecked(authedPage, label, "true");
  });

  test("mentor self-pause toggle", async ({ authedPage, testUser }) => {
    const { error } = await admin
      .from("mentor_profiles")
      .insert({ user_id: testUser.id, status: "approved", base_price_ngn: 10_000 });
    if (error) throw error;

    await authedPage.goto("/mentorship/apply");
    const label = "Pause your mentor listing";
    await authedPage.locator(`[role="switch"][aria-label="${label}"]`).scrollIntoViewIfNeeded();

    const before = await probeSwitch(authedPage, label);
    expect(before.visible).toEqual({ w: 46, h: 26 });
    await expectChecked(authedPage, label, "false");

    await clickSwitchPoint(authedPage, label, "outsideExtension");
    await expectChecked(authedPage, label, "false");

    await clickSwitchPoint(authedPage, label, "insideExtension");
    await expectChecked(authedPage, label, "true");

    await admin.from("mentor_profiles").delete().eq("user_id", testUser.id);
  });

  test("mentor reviews-verifications opt-in toggle", async ({ authedPage, testUser }) => {
    const { error } = await admin
      .from("mentor_profiles")
      .insert({ user_id: testUser.id, status: "approved", base_price_ngn: 10_000 });
    if (error) throw error;

    await authedPage.goto("/mentorship/apply");
    const label = "Review Talent Directory verifications";
    await authedPage.locator(`[role="switch"][aria-label="${label}"]`).scrollIntoViewIfNeeded();

    const before = await probeSwitch(authedPage, label);
    expect(before.visible).toEqual({ w: 46, h: 26 });
    await expectChecked(authedPage, label, "false");

    await clickSwitchPoint(authedPage, label, "outsideExtension");
    await expectChecked(authedPage, label, "false");

    await clickSwitchPoint(authedPage, label, "insideExtension");
    await expectChecked(authedPage, label, "true");

    await admin.from("mentor_profiles").delete().eq("user_id", testUser.id);
  });

  test("Talent Directory listing opt-in toggle", async ({ authedPage, testUser }) => {
    const { error } = await admin
      .from("profiles")
      .update({ talent_verification_status: "verified", talent_verification_score: 90 })
      .eq("id", testUser.id);
    if (error) throw error;

    await authedPage.goto("/talent-directory/verify");
    const firstSwitch = authedPage.locator('[role="switch"]').first();
    await firstSwitch.scrollIntoViewIfNeeded();
    const resolvedLabel = await firstSwitch.getAttribute("aria-label");
    expect(resolvedLabel).toBeTruthy();

    const before = await probeSwitch(authedPage, resolvedLabel!);
    expect(before.visible).toEqual({ w: 46, h: 26 });
    await expectChecked(authedPage, resolvedLabel!, "false");

    await clickSwitchPoint(authedPage, resolvedLabel!, "outsideExtension");
    await expectChecked(authedPage, resolvedLabel!, "false");

    await clickSwitchPoint(authedPage, resolvedLabel!, "insideExtension");
    await expectChecked(authedPage, resolvedLabel!, "true");
  });
});
