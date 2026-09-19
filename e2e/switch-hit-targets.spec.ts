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
 */
import { test, expect, admin } from "./fixtures/authed";

interface SwitchProbe {
  visible: { w: number; h: number };
  insideExtension: { x: number; y: number };
  outsideExtension: { x: number; y: number };
}

/** All measurements/points are computed from the real rendered box, not
 * hardcoded — the fix's own -7px inset is read back from computed style
 * rather than assumed, so a future change to that value doesn't silently
 * make this test click the wrong spot. */
async function probeSwitch(page: import("@playwright/test").Page, ariaLabel: string): Promise<SwitchProbe> {
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

async function ariaChecked(page: import("@playwright/test").Page, ariaLabel: string): Promise<string | null> {
  return page.evaluate(
    (label) => document.querySelector(`[role="switch"][aria-label="${label}"]`)?.getAttribute("aria-checked") ?? null,
    ariaLabel,
  );
}

test.describe("switch toggle hit targets extend beyond the visible 26x46px track", () => {
  test("Auto-Apply toggle (job feed)", async ({ authedPage }) => {
    await authedPage.goto("/jobs");
    const label = "Auto-Apply";
    await authedPage.locator(`[role="switch"][aria-label="${label}"]`).scrollIntoViewIfNeeded();

    const before = await probeSwitch(authedPage, label);
    expect(before.visible).toEqual({ w: 46, h: 26 });
    expect(await ariaChecked(authedPage, label)).toBe("false");

    await authedPage.mouse.click(before.outsideExtension.x, before.outsideExtension.y);
    expect(await ariaChecked(authedPage, label), "a click past the extended zone must NOT toggle it").toBe("false");

    await authedPage.mouse.click(before.insideExtension.x, before.insideExtension.y);
    expect(await ariaChecked(authedPage, label), "a click inside the extended zone, outside the visible pill, must toggle it").toBe(
      "true",
    );

    const after = await probeSwitch(authedPage, label);
    expect(after.visible, "the visible track must not have grown").toEqual({ w: 46, h: 26 });
  });

  test("referral leaderboard opt-in toggle", async ({ authedPage }) => {
    await authedPage.goto("/refer");
    const label = "Appear on the referral leaderboard";
    await authedPage.locator(`[role="switch"][aria-label="${label}"]`).scrollIntoViewIfNeeded();

    const before = await probeSwitch(authedPage, label);
    expect(before.visible).toEqual({ w: 46, h: 26 });
    expect(await ariaChecked(authedPage, label)).toBe("false");

    await authedPage.mouse.click(before.outsideExtension.x, before.outsideExtension.y);
    expect(await ariaChecked(authedPage, label)).toBe("false");

    await authedPage.mouse.click(before.insideExtension.x, before.insideExtension.y);
    expect(await ariaChecked(authedPage, label)).toBe("true");
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
    expect(await ariaChecked(authedPage, label)).toBe("false");

    await authedPage.mouse.click(before.outsideExtension.x, before.outsideExtension.y);
    expect(await ariaChecked(authedPage, label)).toBe("false");

    await authedPage.mouse.click(before.insideExtension.x, before.insideExtension.y);
    expect(await ariaChecked(authedPage, label)).toBe("true");

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
    expect(await ariaChecked(authedPage, label)).toBe("false");

    await authedPage.mouse.click(before.outsideExtension.x, before.outsideExtension.y);
    expect(await ariaChecked(authedPage, label)).toBe("false");

    await authedPage.mouse.click(before.insideExtension.x, before.insideExtension.y);
    expect(await ariaChecked(authedPage, label)).toBe("true");

    await admin.from("mentor_profiles").delete().eq("user_id", testUser.id);
  });

  test("Talent Directory listing opt-in toggle", async ({ authedPage, testUser }) => {
    const { error } = await admin
      .from("profiles")
      .update({ talent_verification_status: "verified", talent_verification_score: 90 })
      .eq("id", testUser.id);
    if (error) throw error;

    await authedPage.goto("/talent-directory/verify");
    const switchLocator = authedPage.locator('[role="switch"]').first();
    await switchLocator.scrollIntoViewIfNeeded();
    const resolvedLabel = await switchLocator.getAttribute("aria-label");
    expect(resolvedLabel).toBeTruthy();

    const before = await probeSwitch(authedPage, resolvedLabel!);
    expect(before.visible).toEqual({ w: 46, h: 26 });
    expect(await ariaChecked(authedPage, resolvedLabel!)).toBe("false");

    await authedPage.mouse.click(before.outsideExtension.x, before.outsideExtension.y);
    expect(await ariaChecked(authedPage, resolvedLabel!)).toBe("false");

    await authedPage.mouse.click(before.insideExtension.x, before.insideExtension.y);
    expect(await ariaChecked(authedPage, resolvedLabel!)).toBe("true");
  });
});
