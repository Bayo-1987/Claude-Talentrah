/**
 * send-498 — the Save toggle's saved state, in a real browser.
 *
 * Unit tests pin the markup (aria-pressed, the rust variant classes). Only a browser proves the variant really changes
 * how the button is DRAWN: a pressed Save must differ from an unpressed one in border and fill, not just in its glyph,
 * and a screen reader is told the state through aria-pressed.
 */
import { randomUUID } from "node:crypto";
import { test, expect, admin } from "./fixtures/authed";
import { runCleanups } from "../tests/support/teardown";
import { deletePostingsCascade } from "../tests/support/delete-orgs";

const jobIds: string[] = [];

test.afterEach(async () => {
  await runCleanups([
    "save-toggle postings",
    async () => {
      if (jobIds.length) await deletePostingsCascade(admin, jobIds.splice(0));
    },
  ]);
});

test("saving a job turns the toggle on, visibly and for assistive tech, and unsaving turns it off", async ({ authedPage }) => {
  const title = `Save Toggle Role ${randomUUID().slice(0, 6)}`;
  const { data, error } = await admin
    .from("job_postings")
    .insert({
      source_type: "external",
      organization_id: null,
      company_name: "Toggle Co",
      title,
      description: "A real fixture posting long enough to render.",
      status: "open",
      location: "Lagos, Nigeria",
      posted_at: new Date().toISOString(),
      external_url: "https://example.test/save-toggle",
      dedup_fingerprint: `e2e-save-toggle-${randomUUID()}`,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`fixture posting: ${error?.message}`);
  jobIds.push(data.id);

  await authedPage.goto(`/jobs?q=${encodeURIComponent(title)}&country=all`);
  const card = authedPage.getByTestId("job-card").filter({ hasText: title });
  await expect(card).toBeVisible();

  const look = (btn: import("@playwright/test").Locator) =>
    btn.evaluate((el) => {
      const s = getComputedStyle(el);
      return { border: s.borderTopColor, background: s.backgroundColor, color: s.color };
    });

  const save = card.getByRole("button", { name: "Save", exact: true });
  await expect(save).toHaveAttribute("aria-pressed", "false");
  const before = await look(save);

  await save.click();
  const unsave = card.getByRole("button", { name: "Unsave", exact: true });
  await expect(unsave).toBeVisible({ timeout: 15_000 });
  await expect(unsave).toHaveAttribute("aria-pressed", "true");
  const after = await look(unsave);

  expect(after.border, "a saved toggle must change its border").not.toBe(before.border);
  expect(after.background, "a saved toggle must change its fill").not.toBe(before.background);
  expect(after.color, "a saved toggle must change its icon colour").not.toBe(before.color);

  await unsave.click();
  await expect(card.getByRole("button", { name: "Save", exact: true })).toHaveAttribute("aria-pressed", "false", { timeout: 15_000 });
});
