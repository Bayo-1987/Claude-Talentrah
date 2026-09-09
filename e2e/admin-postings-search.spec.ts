import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/types";
import { randomUUID } from "node:crypto";
import { acquireOperatorsLock } from "../tests/support/operators-lock";

/**
 * `/admin/postings` — reaching a posting nobody has reported.
 *
 * `/admin/reports`'s own queue is built from an inner join on
 * `job_posting_reports` (reportedPostings()'s own header): a posting with
 * zero reports is structurally invisible there. This is the test that a
 * posting with NO report row at all can still be found and removed through
 * `decideJobPostingAction` — the same action, same reason requirement, same
 * audit trail the reports queue already uses — and that removing it this
 * way still lands on the reports page's own "Removed from the board" list,
 * since that list doesn't care how a posting became `removed`.
 */
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

const admin =
  SERVICE && SUPA_URL
    ? createClient<Database>(SUPA_URL, SERVICE, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;

if (process.env.CI && !admin) {
  throw new Error("admin-postings-search spec cannot run in CI: missing service key or Supabase URL");
}

test("an admin can find a live posting with zero reports and remove it, and it lands on the removed list", async ({
  page,
}) => {
  test.setTimeout(420_000);
  if (!admin) return;
  const releaseOperatorsLock = await acquireOperatorsLock(admin, "e2e-admin-postings-search");

  try {
    const tag = randomUUID().slice(0, 8);
    const email = `aps-op-${tag}@talentrah.test`;
    const password = `E2E-${randomUUID()}Aa1!`;

    // A posting with NO report row at all — the whole point of this page.
    const { data: made, error: pe } = await admin
      .from("job_postings")
      .insert({
        source_type: "external",
        title: `E2E unreported ${tag}`,
        company_name: `E2E Unreported Co ${tag}`,
        external_url: `https://example.invalid/e2e/${tag}`,
        external_source: "e2e",
        status: "open",
        description: `Fixture posting for the admin-postings-search e2e (${tag}), never reported.`,
        dedup_fingerprint: `e2e-aps-${tag}`,
      })
      .select("id")
      .single();
    if (pe || !made) throw new Error(`fixture posting: ${pe?.message}`);
    const postingId = made.id;

    const { data: u, error: ue } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (ue) throw new Error(`fixture operator: ${ue.message}`);
    const { data: role } = await admin
      .from("admin_roles")
      .select("id")
      .eq("name", "Super Admin")
      .single();
    const { error: ae } = await admin
      .from("admin_users")
      .insert({ id: u!.user.id, email, display_name: "aps probe", role_id: role!.id });
    if (ae) throw new Error(`fixture admin_users: ${ae.message}`);

    try {
      await page.goto("/admin/login");
      await page.locator("#admin-email").fill(email);
      await page.locator("#admin-password").fill(password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL((x) => !x.pathname.startsWith("/admin/login"), { timeout: 30_000 });

      // Confirmed absent from the reports queue first — the exact gap this
      // page exists to close. A posting with no reports simply never
      // appears there, so this isn't a "did the removal work" check, it's
      // the premise the whole feature is answering.
      await page.goto("/admin/reports");
      await expect(
        page.getByTestId("reports-queue").locator(`li:has(input[name="id"][value="${postingId}"])`),
      ).toHaveCount(0);

      await page.goto("/admin/postings");
      await page.locator("#postings-q").fill(`E2E unreported ${tag}`);
      await page.getByRole("button", { name: "Search" }).click();

      const results = page.getByTestId("postings-search-results");
      const row = results.locator(`li:has(input[name="id"][value="${postingId}"])`);
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(`E2E unreported ${tag}`);
      await expect(row).toContainText(`E2E Unreported Co ${tag}`);

      await row.getByRole("textbox").fill("E2E: taken down on sight, never reported.");
      await row.getByRole("button", { name: "Remove from the board" }).click();

      await expect(page.getByText(/removed/i)).toBeVisible({ timeout: 15_000 });

      // And it lands where every other removal does — removedPostings()
      // doesn't ask how a posting got to `removed`, but confirm rather than
      // assume, per this repo's own testing convention.
      await page.goto("/admin/reports");
      await expect(
        page.getByTestId("removed-queue").locator(`li:has(input[name="id"][value="${postingId}"])`),
        "a posting removed from the postings-search page must show up in the removed list",
      ).toHaveCount(1, { timeout: 15_000 });

      const { data: after, error: afterErr } = await admin
        .from("job_postings")
        .select("status, removed_by, removal_reason")
        .eq("id", postingId)
        .single();
      if (afterErr) throw new Error(`re-read of ${postingId} failed: ${afterErr.message}`);
      expect(after?.status).toBe("removed");
      expect(after?.removed_by, "the remover must be recorded").toBe(u!.user.id);
      expect(after?.removal_reason).toBe("E2E: taken down on sight, never reported.");
    } finally {
      const { error: dp } = await admin.from("job_postings").delete().eq("id", postingId);
      if (dp) console.error("[aps cleanup] posting:", dp.message);
      const { error: da } = await admin.from("admin_audit_log").delete().eq("admin_user_id", u!.user.id);
      if (da) console.error("[aps cleanup] audit:", da.message);
      const { error: dau } = await admin.from("admin_users").delete().eq("id", u!.user.id);
      if (dau) console.error("[aps cleanup] admin_users:", dau.message);
      const { error } = await admin.auth.admin.deleteUser(u!.user.id);
      if (error) console.error("[aps cleanup] user:", error.message);
    }
  } finally {
    await releaseOperatorsLock();
  }
});
