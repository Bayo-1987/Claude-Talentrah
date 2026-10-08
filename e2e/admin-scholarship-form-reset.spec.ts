import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "../src/lib/supabase/types";
import { fakeSecret } from "../tests/support/fake-secret";

/**
 * /admin/scholarships/new: after "Save as pending" EVERY field is empty again, including the "Other eligibility notes" rich editor. That editor is uncontrolled (TipTap's own
 * document), so React's form reset cannot clear it; it kept the previous listing's text and an operator adding a second listing would carry it over. The operator here holds only
 * the "scholarships" permission; the listing is named with a run tag and removed afterwards. The failing-save case (the editor KEEPS its text) is pinned in
 * tests/scholarships/admin-form-editor-reset.test.tsx, where a field error can be produced without relying on the browser's own validation.
 */
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const configured = Boolean(URL_ && SERVICE);
if (process.env.CI && !configured) {
  throw new Error("admin-scholarship-form-reset spec cannot run in CI: missing Supabase credentials");
}
const db: SupabaseClient<Database> | null = configured
  ? createClient<Database>(URL_!, SERVICE!, { auth: { persistSession: false } })
  : null;

const RUN_TAG = randomUUID().slice(0, 8);
let op = { id: "", email: "", password: "" };
let roleId = "";

async function signIn(page: Page) {
  await page.goto("/admin/login");
  await page.locator("#admin-email").fill(op.email);
  await page.locator("#admin-password").fill(op.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/admin/login"), { timeout: 30_000 });
}

test.describe("admin New listing form", () => {
  test.skip(!configured, "needs Supabase credentials");

  test.beforeAll(async () => {
    const { data: r, error: re } = await db!.from("admin_roles").insert({ name: `sch-reset-e2e ${RUN_TAG}` }).select("id").single();
    if (re) throw new Error(`fixture role: ${re.message}`);
    roleId = r!.id;
    const { error: pe } = await db!.from("admin_role_permissions").insert({ role_id: roleId, permission: "scholarships" });
    if (pe) throw new Error(`fixture perms: ${pe.message}`);
    const email = `sch-reset-e2e-${randomUUID()}@talentrah.test`;
    const password = fakeSecret("password");
    const { data: u, error: ue } = await db!.auth.admin.createUser({ email, password, email_confirm: true });
    if (ue) throw new Error(`fixture user: ${ue.message}`);
    const { error: ae } = await db!.from("admin_users").insert({ id: u!.user.id, email, display_name: "sch reset", role_id: roleId });
    if (ae) throw new Error(`fixture operator: ${ae.message}`);
    op = { id: u!.user.id, email, password };
  });

  test.afterAll(async () => {
    if (!db) return;
    const { error: se } = await db.from("scholarships").delete().like("program_name", `E2E reset ${RUN_TAG}%`);
    if (se) console.error("[sch-reset-e2e cleanup] scholarships:", se.message);
    const { error: ae } = await db.from("admin_audit_log").delete().eq("admin_user_id", op.id);
    if (ae) console.error("[sch-reset-e2e cleanup] audit:", ae.message);
    const { error: ue } = await db.from("admin_users").delete().eq("id", op.id);
    if (ue) console.error("[sch-reset-e2e cleanup] admin_users:", ue.message);
    const { error: de } = await db.auth.admin.deleteUser(op.id);
    if (de) console.error("[sch-reset-e2e cleanup] user:", de.message);
    const { error: re } = await db.from("admin_roles").delete().eq("id", roleId);
    if (re) console.error("[sch-reset-e2e cleanup] role:", re.message);
  });

  test("after one listing is saved, every field is empty again, including the eligibility notes editor", async ({ page }) => {
    await signIn(page);
    await page.goto("/admin/scholarships/new");

    await page.getByLabel("Provider").fill(`E2E provider ${RUN_TAG}`);
    await page.getByLabel("Programme name").fill(`E2E reset ${RUN_TAG} first`);
    await page.getByLabel("Host institution (optional)").fill("E2E University");
    await page.getByRole("checkbox").first().check();
    await page.getByLabel("Funding").selectOption({ index: 1 });
    await page.getByLabel("Official source URL").fill(`https://example.test/e2e-reset-${RUN_TAG}`);
    const editor = page.locator("#eligibilityOther");
    await editor.click();
    await page.keyboard.type("Open to applicants from anywhere. Carried over?");
    await expect(editor).toContainText("Carried over?");

    await page.getByRole("button", { name: "Save as pending" }).click();
    await expect(page.getByText("Saved as pending.")).toBeVisible({ timeout: 30_000 });

    // Every text field, the select and the checkboxes are back to empty...
    for (const label of ["Provider", "Programme name", "Host institution (optional)", "Official source URL"]) {
      await expect(page.getByLabel(label), `${label} should be empty after a save`).toHaveValue("");
    }
    await expect(page.getByLabel("Funding")).toHaveValue("");
    await expect(page.getByRole("checkbox").first()).not.toBeChecked();
    // ...and so is the rich-text editor: nothing visible, nothing that would be submitted with the next listing.
    await expect(editor, "the eligibility notes editor kept the previous listing's text").toHaveText("");
    await expect(page.locator('input[name="eligibilityOther"]')).toHaveValue("");
  });
});
