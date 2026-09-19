/**
 * send-375 — `claim-candidate-card.tsx`'s own description field was the
 * second, unfixed doorway into `job_postings.description`: send-367
 * replaced `job-posting-form.tsx`'s plain textarea with `RichMarkdownEditor`,
 * but this "claim your listing" review screen still had its own separate
 * plain `<textarea name="description">`, writing to the exact same column
 * through the exact same renderer. The founder's original reported bug
 * (paste a formatted document, get a flattened wall of text) was still
 * fully reproducible here even after send-367 shipped.
 *
 * This test proves the fix the same way send-367's own suite
 * (e2e/job-description-rich-editor.spec.ts) proved the create-job form: a
 * real paste ClipboardEvent converts live, and the value that actually lands
 * in the database round-trips through the exact serializer/deserializer
 * pair that suite's unit tests already cover byte-for-byte — this file only
 * needs to prove THIS mounting site wires up correctly, not re-prove the
 * pipeline itself.
 */
import { test, expect, admin } from "./fixtures/authed";
import { runCleanups } from "../tests/support/teardown";
import { deleteOrgsCascade } from "../tests/support/delete-orgs";
import { randomUUID } from "node:crypto";

test.describe("claim-listing rich editor", () => {
  let orgId: string | undefined;
  let externalPostingId: string | undefined;

  test.afterEach(async () => {
    await runCleanups(
      [
        "claim e2e external posting",
        async () => {
          if (externalPostingId) {
            const { error } = await admin.from("job_postings").delete().eq("id", externalPostingId);
            if (error) throw new Error(`cleanup external posting: ${error.message}`);
          }
        },
      ],
      [
        "claim e2e organisation",
        async () => {
          if (orgId) await deleteOrgsCascade(admin, [orgId]);
        },
      ],
    );
  });

  test("pasting a formatted description into the claim-review card converts live and round-trips through the real published posting", async ({
    authedPage,
  }) => {
    const tag = randomUUID().slice(0, 8);
    const orgName = `E2E Claim Co ${tag}`;

    await authedPage.goto("/employer/onboarding");
    await authedPage.getByLabel("Company name").fill(orgName);
    await authedPage.getByRole("button", { name: "Create company" }).click();
    await expect(authedPage).toHaveURL(/\/employer\/jobs$/);
    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .select("id")
      .eq("name", orgName)
      .single();
    if (orgErr || !org) throw new Error(`fixture org: ${orgErr?.message}`);
    orgId = org.id;
    // Verified so the claim page actually shows candidates (unverified stops
    // at its own "verify first" notice — this page's own explicit gate).
    const { error: verifyErr } = await admin.from("organizations").update({ verified: true }).eq("id", orgId);
    if (verifyErr) throw new Error(`fixture verify: ${verifyErr.message}`);

    // Company-name match is the confidence=name path (0128) — the
    // normalized company name has to equal the org's own, exactly what a
    // real aggregated posting for this same company would look like.
    const { data: posting, error: postingErr } = await admin
      .from("job_postings")
      .insert({
        source_type: "external",
        title: `Backend Engineer ${tag}`,
        company_name: orgName,
        external_url: `https://boards.example.invalid/e2e/${tag}`,
        external_source: "e2e",
        status: "open",
        description: "Old, thin, externally-sourced description text — not what gets claimed.",
        dedup_fingerprint: `e2e-claim-${tag}`,
      })
      .select("id")
      .single();
    if (postingErr || !posting) throw new Error(`fixture posting: ${postingErr?.message}`);
    externalPostingId = posting.id;

    await authedPage.goto("/employer/claim");
    await expect(authedPage.getByText(`Backend Engineer ${tag}`)).toBeVisible();
    await authedPage.getByRole("button", { name: "Review & claim" }).click();

    // Unlike job-posting-form.tsx's own description field (mounted from the
    // moment the page loads), this card's editor only mounts once "Review &
    // claim" is clicked — TipTap's `immediatelyRender: false` means the
    // placeholder DOM node can exist a tick before ProseMirror's own paste
    // handling is actually wired up. The toolbar renders from the exact
    // same `if (!editor) return null` gate as the editor content, so
    // waiting for it first is waiting for the real thing this test needs,
    // not an arbitrary delay.
    await expect(authedPage.getByRole("toolbar", { name: "Formatting" })).toBeVisible();

    // Real paste ClipboardEvent — same mechanism send-367's own e2e suite
    // uses, exercising the actual sanitizer/deserializer, not a hand-typed
    // string.
    const selector = `#description-${posting.id}`;
    await authedPage.locator(selector).click();
    await authedPage.evaluate(
      ({ selector, html, text }) => {
        const el = document.querySelector(selector) as HTMLElement;
        el.focus();
        const dataTransfer = new DataTransfer();
        dataTransfer.setData("text/html", html);
        dataTransfer.setData("text/plain", text);
        const event = new ClipboardEvent("paste", { clipboardData: dataTransfer, bubbles: true, cancelable: true });
        el.dispatchEvent(event);
      },
      {
        selector,
        html: "<h2>About the role</h2><p>We need someone with <strong>real ownership</strong>.</p><ul><li>Own the roadmap</li><li>Ship weekly</li></ul>",
        text: "About the role\nWe need someone with real ownership.\nOwn the roadmap\nShip weekly",
      },
    );

    // Live-converted in THIS card's editor, not flattened — the exact
    // regression this fix closes.
    await expect(authedPage.locator(`${selector} h2`)).toHaveText("About the role");
    await expect(authedPage.locator(`${selector} strong`)).toHaveText("real ownership");
    await expect(authedPage.locator(`${selector} li`)).toHaveCount(2);

    await authedPage.getByRole("button", { name: "Claim this listing" }).click();
    await expect(authedPage).toHaveURL(/\/employer\/jobs\?claimed=.+$/);
    const claimedJobId = new URL(authedPage.url()).searchParams.get("claimed")!;

    const { data: claimed, error: claimedErr } = await admin
      .from("job_postings")
      .select("description, source_type, organization_id")
      .eq("id", claimedJobId)
      .single();
    if (claimedErr || !claimed) throw new Error(`reading claimed posting: ${claimedErr?.message}`);
    expect(claimed.source_type).toBe("internal");
    expect(claimed.organization_id).toBe(orgId);
    // Same CRLF normalization send-367's own e2e suite documents (a real
    // browser's own form-submission behaviour, not this feature's code).
    expect(claimed.description?.replace(/\r\n/g, "\n")).toBe(
      "## About the role\n\nWe need someone with **real ownership**.\n\n- Own the roadmap\n- Ship weekly",
    );

    // The claimed listing is now a real internal posting, saved and
    // reloaded through the SAME renderer the create-job form's own postings
    // use — round-trip proven end to end, not just "the value looks right
    // in the database."
    await authedPage.goto(`/jobs/${claimedJobId}`);
    const description = authedPage.getByTestId("job-full-description");
    await expect(description.locator("h2, p.font-semibold")).toContainText("About the role");
    await expect(description.locator("strong")).toHaveText("real ownership");
    await expect(description.locator("li")).toHaveCount(2);

    // The original external listing left the public feed, per this
    // feature's own stated contract ("takes the old one out of the public
    // feed") — not this PR's own concern to re-verify in depth, but a
    // cheap, real check that claiming actually did what it says.
    const { data: original } = await admin
      .from("job_postings")
      .select("claimed_by_organization_id")
      .eq("id", externalPostingId)
      .single();
    expect(original?.claimed_by_organization_id).toBe(orgId);
  });
});
