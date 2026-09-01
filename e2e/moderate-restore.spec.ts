import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "../src/lib/supabase/types";
import { acquireOperatorsLock } from "../tests/support/operators-lock";

/**
 * The moderation round trip, walked through the screens.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * #132: M2 shipped a Restore button that could never succeed. The reports
 * queue excluded removed postings and the restore action only acted on removed
 * ones, so the control rendered on every row that could not use it and never on
 * a row that could. The query was correct the whole time; the SCREEN was
 * unusable. #182 fixed it with a removed-postings list.
 *
 * Nothing drove that control afterwards. `tests/rls/job-posting-restore` proves
 * the round trip at the database layer — which is exactly the layer that was
 * never broken. A test that clicks Restore is the one that would have caught
 * the original bug, and until this spec there was none.
 *
 * Ported from wip/admin-e2e-followon, whose own version could not be landed as
 * written: it drove `/api/admin/moderate-job-posting`, retired by #179.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const configured = Boolean(SUPABASE_URL && SERVICE);
const db = configured
  ? createClient<Database>(SUPABASE_URL!, SERVICE!, { auth: { persistSession: false } })
  : null;

test.describe("moderating a posting, from the screens an operator uses", () => {
  test.skip(!configured, "needs the Supabase URL and service-role key");

  test("remove it, find it, restore it — and it lands in closed, never open", async ({ page }) => {
    // Generous: this queues on the operators lease before doing anything, and
    // its fixture is a Super Admin, so it moves the global coverage count.
    test.setTimeout(420_000);
    if (!db) return;

    const releaseOperatorsLock = await acquireOperatorsLock(db, "e2e-moderate-restore");
    const tag = randomUUID().slice(0, 8);
    const created: { users: string[]; postings: string[] } = { users: [], postings: [] };

    try {
      // ── fixtures, all its own ────────────────────────────────────────────
      // Its own reporter rather than a borrowed profile: `reporter_id` is ON
      // DELETE CASCADE, so a profile owned by another suite disappearing
      // mid-run takes the report — and the queue row — with it.
      const { data: reporter, error: rErr } = await db.auth.admin.createUser({
        email: `modrestore-reporter-${tag}@talentrah.test`,
        password: `E2E-${randomUUID()}Aa1!`,
        email_confirm: true,
      });
      if (rErr) throw new Error(`fixture reporter: ${rErr.message}`);
      created.users.push(reporter!.user.id);

      const title = `E2E restore ${tag}`;
      const { data: posting, error: pErr } = await db
        .from("job_postings")
        .insert({
          source_type: "external",
          title,
          company_name: `E2E Restore Co ${tag}`,
          external_url: `https://example.invalid/e2e/restore/${tag}`,
          external_source: "e2e",
          status: "open",
          description: `Fixture posting for the moderation round trip (${tag}).`,
          dedup_fingerprint: `e2e-restore-${tag}`,
        })
        .select("id")
        .single();
      if (pErr) throw new Error(`fixture posting: ${pErr.message}`);
      created.postings.push(posting!.id);
      const jobId = posting!.id;

      // The reports queue only lists postings that someone has reported.
      const { error: repErr } = await db.from("job_posting_reports").insert({
        job_posting_id: jobId,
        reporter_id: reporter!.user.id,
        reason: "scam",
        details: `E2E-REPORT restore round trip ${tag}`,
      });
      if (repErr) throw new Error(`fixture report: ${repErr.message}`);

      const email = `modrestore-op-${tag}@talentrah.test`;
      const password = `E2E-${randomUUID()}Aa1!`;
      const { data: op, error: oErr } = await db.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (oErr) throw new Error(`fixture operator: ${oErr.message}`);
      created.users.push(op!.user.id);
      const { data: role } = await db
        .from("admin_roles")
        .select("id")
        .eq("name", "Super Admin")
        .single();
      const { error: aErr } = await db
        .from("admin_users")
        .insert({ id: op!.user.id, email, display_name: "restore probe", role_id: role!.id });
      if (aErr) throw new Error(`fixture admin_users: ${aErr.message}`);

      // ── sign in ──────────────────────────────────────────────────────────
      await page.goto("/admin/login");
      await page.locator("#admin-email").fill(email);
      await page.locator("#admin-password").fill(password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL((u) => !u.pathname.startsWith("/admin/login"), { timeout: 30_000 });

      await page.goto("/admin/reports");
      expect(new URL(page.url()).pathname).toBe("/admin/reports");

      const reportsQueue = page.getByTestId("reports-queue");
      const removedQueue = page.getByTestId("removed-queue");
      const rowIn = (list: typeof reportsQueue) =>
        list.locator(`li:has(input[name="id"][value="${jobId}"])`);

      await expect(rowIn(reportsQueue)).toHaveCount(1);

      // THE M2 BUG, PINNED AT THE UI. A posting listed here is by definition
      // not removed, so a Restore control on this row could never fire.
      await expect(
        rowIn(reportsQueue).getByRole("button", { name: /restore/i }),
        "the open queue must not offer Restore — that was the original defect",
      ).toHaveCount(0);

      // ── remove: the reason rule, observed through the screen ─────────────
      // Neither option sets `requiresNote`, so this reaches the Server Action
      // and comes back as a real refusal rather than a client-side guard.
      await rowIn(reportsQueue).getByRole("button", { name: "Remove from the board" }).click();
      await expect(rowIn(reportsQueue).getByRole("status")).toContainText(/need a reason/i);

      const stillOpen = await db
        .from("job_postings")
        .select("status")
        .eq("id", jobId)
        .single();
      expect(stillOpen.data?.status, "a refused removal must not have changed anything").toBe(
        "open",
      );

      await rowIn(reportsQueue)
        .getByRole("textbox")
        .fill(`Reported as an advance-fee scam. ${tag}`);
      await rowIn(reportsQueue).getByRole("button", { name: "Remove from the board" }).click();

      // It leaves the open queue AND turns up where an operator can act on it.
      // Both halves matter: M2 satisfied the first and lost the posting.
      await expect(rowIn(reportsQueue)).toHaveCount(0, { timeout: 15_000 });
      await expect(rowIn(removedQueue)).toHaveCount(1, { timeout: 15_000 });
      await expect(rowIn(removedQueue)).toContainText("advance-fee");

      const removed = await db
        .from("job_postings")
        .select("status, removal_reason, removed_by, removed_at")
        .eq("id", jobId)
        .single();
      expect(removed.data?.status).toBe("removed");
      expect(removed.data?.removed_by, "attributed to the operator who clicked").toBe(
        op!.user.id,
      );
      expect(removed.data?.removed_at).not.toBeNull();

      // ── restore: same rule, other direction ──────────────────────────────
      await rowIn(removedQueue).getByRole("button", { name: "Restore to closed" }).click();
      await expect(rowIn(removedQueue).getByRole("status")).toContainText(/need a reason/i);

      const stillRemoved = await db
        .from("job_postings")
        .select("status")
        .eq("id", jobId)
        .single();
      expect(stillRemoved.data?.status, "a refused restore must not have changed anything").toBe(
        "removed",
      );

      await rowIn(removedQueue)
        .getByRole("textbox")
        .fill(`Report was wrong — verified the employer. ${tag}`);
      await rowIn(removedQueue).getByRole("button", { name: "Restore to closed" }).click();

      // Scoped to THIS posting rather than to the list being empty: the empty
      // state only renders when nothing at all is removed, so asserting it
      // would pass on a quiet database and fail the moment any other fixture
      // coexists — green for a reason unrelated to restore working.
      await expect(rowIn(removedQueue)).toHaveCount(0, { timeout: 15_000 });

      const after = await db
        .from("job_postings")
        .select("status, removed_at, removal_reason, removed_by")
        .eq("id", jobId)
        .single();

      // CLOSED, NEVER OPEN. Restoring says the removal was wrong; it does not
      // say the job is live — only the ingest or the employer knows that.
      expect(after.data?.status, "restore must land in closed, not open").toBe("closed");
      expect(after.data?.removed_at, "both stamps clear together").toBeNull();
      expect(after.data?.removal_reason).toBeNull();

      // Both decisions are attributed, which the retired shared-secret route
      // could never do.
      const { data: log } = await db
        .from("admin_audit_log")
        .select("action")
        .eq("admin_user_id", op!.user.id);
      expect((log ?? []).length, "both decisions recorded against this operator").toBeGreaterThan(
        1,
      );
    } finally {
      for (const id of created.postings) {
        const { error } = await db.from("job_postings").delete().eq("id", id);
        if (error) console.error("[modrestore cleanup] posting:", error.message);
      }
      for (const id of created.users) {
        const { error: la } = await db.from("admin_audit_log").delete().eq("admin_user_id", id);
        if (la) console.error("[modrestore cleanup] audit:", la.message);
        const { error: au } = await db.from("admin_users").delete().eq("id", id);
        if (au) console.error("[modrestore cleanup] admin_users:", au.message);
        const { error } = await db.auth.admin.deleteUser(id);
        if (error) console.error("[modrestore cleanup] user:", error.message);
      }
      await releaseOperatorsLock();
    }
  });
});
