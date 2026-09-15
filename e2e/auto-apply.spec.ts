/**
 * Auto-Apply, driven through the real UI and checked in the real database.
 *
 * The point of this spec is the last assertion in each test: that a row exists
 * (or doesn't) in Postgres afterwards. A UI-only assertion — "the card
 * disappeared", "a success message showed" — is exactly the shape of test that
 * would have missed 0026, where the policy looked fine and the write went
 * somewhere it shouldn't. This feature creates applications and spends credits
 * without a human clicking Apply at the moment of submission, so the UI saying
 * it worked is not evidence that it did.
 */
import { test, expect, admin, seedBaseResume } from "./fixtures/authed";

const HIGH_SCORE = 95;

test.describe("auto-apply", () => {
  test("the feed toggle turns it on, and the state is real", async ({ authedPage, testUser }) => {
    await authedPage.goto("/jobs");

    const toggle = authedPage.getByRole("switch", { name: "Auto-Apply" });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    // The copy is the product position — it has to say what it won't do before
    // it is switched on, not after (build-prompt §2.3).
    await expect(authedPage.getByText("Review first")).toBeVisible();
    await expect(
      authedPage.getByText(/Nothing is sent until you confirm it/),
    ).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");

    /*
     * aria-checked flips optimistically, so it is NOT evidence the server did
     * anything — asserting the database straight after it raced the action and
     * failed. The review-queue link below renders from the SERVER prop
     * (`{enabled && …}`), so it only appears once the write has landed and the
     * page has re-rendered. That is the signal worth waiting on.
     */
    await expect(
      authedPage.getByRole("link", { name: /Review queue|waiting for review/ }),
    ).toBeVisible({ timeout: 20_000 });

    const { data } = await admin
      .from("auto_apply_settings")
      .select("enabled, enabled_at")
      .eq("user_id", testUser.id)
      .single();
    expect(data?.enabled, "the toggle didn't actually persist").toBe(true);
    expect(data?.enabled_at, "enabled_at should be stamped server-side").not.toBeNull();
  });

  test("confirming a queued internal match creates a real application", async ({
    authedPage,
    testUser,
  }) => {
    await seedBaseResume(testUser.id);

    const { data: job } = await admin
      .from("job_postings")
      .select("id, title")
      .eq("source_type", "internal")
      .eq("status", "open")
      .limit(1)
      .single();

    /*
     * Score and queue row are seeded with the service role, which is the only
     * thing that CAN write them (0031, 0033) — and deliberately not by loading
     * /jobs first, because the feed recomputes match scores on every load and
     * would overwrite the seeded score with whatever this throwaway résumé
     * genuinely earns. The scan itself has its own coverage in
     * tests/auto-apply/enforcement.test.ts; what this test is for is the
     * confirmation path.
     *
     * `explanation` is rich enough (> THIN_SCREENABLE_TAG_MAX,
     * src/lib/match-tier.ts) to clear 0164's thin-match gate deliberately —
     * this test is about the general confirm-success path, not the
     * thin-match gate itself (see the two tests below this one, and
     * tests/auto-apply/thin-match-gate.test.ts). Without this, the gate
     * correctly rejects the DB default `explanation: '{}'` as thin (0 tags),
     * and the queue item never disappears — caught live in CI, not assumed.
     */
    await admin.from("match_scores").upsert(
      {
        user_id: testUser.id,
        job_posting_id: job!.id,
        score: HIGH_SCORE,
        tier: "excellent",
        explanation: {
          matchedSkills: ["sql", "python", "leadership", "stakeholder management"],
          missingSkills: ["kubernetes"],
          seniorityAlignment: "match",
        },
      },
      { onConflict: "user_id,job_posting_id" },
    );
    await admin.from("auto_apply_settings").upsert(
      { user_id: testUser.id, enabled: true, enabled_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
    await admin.from("auto_apply_queue").insert({
      user_id: testUser.id,
      job_posting_id: job!.id,
      match_score: HIGH_SCORE,
      tier: "excellent",
      source_type: "internal",
      status: "pending",
    });

    await authedPage.goto("/auto-apply");
    await expect(authedPage.getByRole("heading", { name: job!.title })).toBeVisible();
    await expect(authedPage.getByText(`${HIGH_SCORE}%`).first()).toBeVisible();
    // The internal-vs-external promise is different, and the card has to say which.
    await expect(
      authedPage.getByText("Confirming applies on Talentrah with your base resume."),
    ).toBeVisible();

    await authedPage.getByRole("button", { name: "Confirm and apply" }).click();

    /*
     * Wait for the CARD to go, not the button.
     *
     * The first version of this waited for the "Confirm and apply" button to
     * disappear — which passed instantly and for the wrong reason: the button
     * relabels itself to "Working…" while the action is in flight, so the
     * locator stopped matching before the server had done anything, and the
     * database assertions below then ran against a submission that hadn't
     * happened yet. The heading only disappears once the server has re-rendered
     * the queue without this item, which is the thing actually worth waiting on.
     */
    await expect(
      authedPage.getByRole("heading", { name: job!.title }),
    ).toHaveCount(0, { timeout: 20_000 });

    // ---- The assertions that matter: what is actually in the database. ----
    const { data: application } = await admin
      .from("applications")
      .select("stage, source, applied_at")
      .eq("user_id", testUser.id)
      .eq("job_posting_id", job!.id)
      .single();
    expect(application?.source, "the application must be attributed to auto_apply").toBe(
      "auto_apply",
    );
    expect(application?.stage).toBe("applied");
    expect(application?.applied_at).not.toBeNull();

    const { data: queueRow } = await admin
      .from("auto_apply_queue")
      .select("status, decided_at, application_id, credits_spent")
      .eq("user_id", testUser.id)
      .eq("job_posting_id", job!.id)
      .single();
    expect(queueRow?.status, "the activity log must record the submission").toBe("submitted");
    expect(queueRow?.decided_at, "the log must record WHEN").not.toBeNull();
    expect(queueRow?.application_id, "the log must link to the application it created").not.toBeNull();
    // First submissions of the week are free — see AUTO_APPLY_FREE_PER_WEEK.
    expect(queueRow?.credits_spent).toBe(0);

    // And it shows up where the user tracks their applications.
    await authedPage.goto("/tracker");
    await expect(authedPage.getByText(job!.title).first()).toBeVisible();
  });

  test("a thin-tag match in the review queue shows the honest qualified badge, not a bare Excellent", async ({
    authedPage,
    testUser,
  }) => {
    /*
     * This is the exact gap send-249 found: the review queue built each
     * QueueItem from auto_apply_queue's own columns only, never reading
     * match_scores.explanation, so MatchTierBadge's thin-match logic
     * (isThin, screenableTagTotal) was unconditionally inert on this one
     * screen — the literal page a user confirms a match from. One
     * screenable tag, exactly the One Acre Fund / Global MEL Manager shape.
     */
    const { data: job } = await admin
      .from("job_postings")
      .select("id, title")
      .eq("source_type", "internal")
      .eq("status", "open")
      .limit(1)
      .single();

    await admin.from("match_scores").upsert(
      {
        user_id: testUser.id,
        job_posting_id: job!.id,
        score: HIGH_SCORE,
        tier: "excellent",
        explanation: {
          matchedSkills: ["project management"],
          missingSkills: [],
          seniorityAlignment: "unknown",
        },
      },
      { onConflict: "user_id,job_posting_id" },
    );
    await admin.from("auto_apply_queue").insert({
      user_id: testUser.id,
      job_posting_id: job!.id,
      match_score: HIGH_SCORE,
      tier: "excellent",
      source_type: "internal",
      status: "pending",
    });

    await authedPage.goto("/auto-apply");
    await expect(authedPage.getByRole("heading", { name: job!.title })).toBeVisible();
    // The honesty signal must reach this screen — this is the assertion
    // that would have failed before the fix, since explanation never
    // reached MatchTierBadge here at all.
    await expect(authedPage.getByText(/thin match/i)).toBeVisible();
  });

  test("a genuinely well-supported match in the review queue still shows a plain Excellent", async ({
    authedPage,
    testUser,
  }) => {
    // The other half of the same proof: wiring explanation through must not
    // make every match look thin — only ones that actually are.
    const { data: job } = await admin
      .from("job_postings")
      .select("id, title")
      .eq("source_type", "internal")
      .eq("status", "open")
      .limit(1)
      .single();

    await admin.from("match_scores").upsert(
      {
        user_id: testUser.id,
        job_posting_id: job!.id,
        score: HIGH_SCORE,
        tier: "excellent",
        explanation: {
          matchedSkills: ["sql", "python", "leadership", "stakeholder management"],
          missingSkills: ["kubernetes"],
          seniorityAlignment: "match",
        },
      },
      { onConflict: "user_id,job_posting_id" },
    );
    await admin.from("auto_apply_queue").insert({
      user_id: testUser.id,
      job_posting_id: job!.id,
      match_score: HIGH_SCORE,
      tier: "excellent",
      source_type: "internal",
      status: "pending",
    });

    await authedPage.goto("/auto-apply");
    await expect(authedPage.getByRole("heading", { name: job!.title })).toBeVisible();
    await expect(authedPage.getByText(`${HIGH_SCORE}% · Excellent`)).toBeVisible();
    await expect(authedPage.getByText(/thin match/i)).toHaveCount(0);
  });

  test("dismissing leaves no application behind", async ({ authedPage, testUser }) => {
    const { data: job } = await admin
      .from("job_postings")
      .select("id, title")
      .eq("source_type", "internal")
      .eq("status", "open")
      .limit(1)
      .single();

    await admin.from("match_scores").upsert(
      { user_id: testUser.id, job_posting_id: job!.id, score: HIGH_SCORE, tier: "excellent" },
      { onConflict: "user_id,job_posting_id" },
    );
    await admin.from("auto_apply_queue").insert({
      user_id: testUser.id,
      job_posting_id: job!.id,
      match_score: HIGH_SCORE,
      tier: "excellent",
      source_type: "internal",
      status: "pending",
    });

    await authedPage.goto("/auto-apply");
    await authedPage.getByRole("button", { name: "Not this one" }).click();
    // Same reasoning as above: wait for the item, not the control.
    await expect(authedPage.getByRole("heading", { name: job!.title })).toHaveCount(0, {
      timeout: 20_000,
    });

    const { data: apps } = await admin
      .from("applications")
      .select("id")
      .eq("user_id", testUser.id)
      .eq("job_posting_id", job!.id);
    expect(apps ?? [], "dismissing must not apply to anything").toHaveLength(0);

    const { data: queueRow } = await admin
      .from("auto_apply_queue")
      .select("status")
      .eq("user_id", testUser.id)
      .eq("job_posting_id", job!.id)
      .single();
    expect(queueRow?.status).toBe("dismissed");
  });
});
