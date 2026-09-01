import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "../src/lib/supabase/types";

/**
 * /admin/feature-flags across the layers only a browser reaches: the nav, the
 * page guard, and the Server Action driven from the real form.
 *
 * tests/rls/feature-flags.test.ts covers the database. This covers the three
 * above it, and the Server Action case is driven the way #163's spec proved
 * works: render the form while permitted, revoke the permission with the form
 * still on screen, then submit. Permissions are read per request, so the
 * submit arrives from an operator who no longer holds it — which is exactly
 * the "the page guard already ran" shape. A hand-forged Server Action POST is
 * 404'd and would pass without invoking anything.
 */
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const configured = Boolean(URL_ && SERVICE);
if (process.env.CI && !configured) {
  throw new Error("admin-feature-flags spec cannot run in CI: missing Supabase credentials");
}
const db: SupabaseClient<Database> | null = configured
  ? createClient<Database>(URL_!, SERVICE!, { auth: { persistSession: false } })
  : null;

const RUN_TAG = randomUUID().slice(0, 8);
let holder = { id: "", email: "", password: "" };
let outsider = { id: "", email: "", password: "" };
let holderRole = "", outsiderRole = "", flagKey = "";

async function makeOperator(label: string, perms: Database["public"]["Enums"]["admin_permission"][]) {
  const { data: r, error: re } = await db!
    .from("admin_roles").insert({ name: `ff-e2e ${label} ${RUN_TAG}` }).select("id").single();
  if (re) throw new Error(`fixture role: ${re.message}`);
  if (perms.length) {
    const { error: pe } = await db!.from("admin_role_permissions")
      .insert(perms.map((permission) => ({ role_id: r!.id, permission })));
    if (pe) throw new Error(`fixture perms: ${pe.message}`);
  }
  const email = `ff-e2e-${label}-${randomUUID()}@talentrah.test`;
  const password = `E2E-${randomUUID()}Aa1!`;
  const { data: u, error: ue } = await db!.auth.admin.createUser({ email, password, email_confirm: true });
  if (ue) throw new Error(`fixture user: ${ue.message}`);
  const { error: ae } = await db!.from("admin_users")
    .insert({ id: u!.user.id, email, display_name: `ff ${label}`, role_id: r!.id });
  if (ae) throw new Error(`fixture operator: ${ae.message}`);
  return { op: { id: u!.user.id, email, password }, roleId: r!.id };
}

async function signIn(page: Page, op: { email: string; password: string }) {
  await page.goto("/admin/login");
  await page.locator("#admin-email").fill(op.email);
  await page.locator("#admin-password").fill(op.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/admin/login"), { timeout: 30_000 });
}

test.describe("feature flags", () => {
  test.skip(!configured, "needs Supabase credentials");

  test.beforeAll(async () => {
    const h = await makeOperator("holder", ["feature_flags", "courses"]);
    holder = h.op; holderRole = h.roleId;
    const o = await makeOperator("outsider", ["courses"]);
    outsider = o.op; outsiderRole = o.roleId;

    flagKey = `e2e_flag_${RUN_TAG}`;
    const { error } = await db!.from("feature_flags")
      .insert({ key: flagKey, label: `E2E flag ${RUN_TAG}`, enabled: false });
    if (error) throw new Error(`fixture flag: ${error.message}`);
  });

  test.afterAll(async () => {
    if (!db) return;
    const ids = [holder.id, outsider.id].filter(Boolean);
    const { error: ae } = await db.from("admin_audit_log").delete().in("admin_user_id", ids);
    if (ae) console.error("[ff-e2e cleanup] audit:", ae.message);
    if (flagKey) {
      const { error } = await db.from("feature_flags").delete().eq("key", flagKey);
      if (error) console.error("[ff-e2e cleanup] flag:", error.message);
    }
    const { error: ue } = await db.from("admin_users").delete().in("id", ids);
    if (ue) console.error("[ff-e2e cleanup] admin_users:", ue.message);
    for (const id of ids) {
      const { error } = await db.auth.admin.deleteUser(id);
      if (error) console.error("[ff-e2e cleanup] user:", error.message);
    }
    const { error } = await db.from("admin_roles").delete().in("id", [holderRole, outsiderRole]);
    if (error) console.error("[ff-e2e cleanup] roles:", error.message);
  });

  test("an operator without the permission sees no link and is refused at the URL", async ({ page }) => {
    await signIn(page, outsider);
    await expect(page.getByRole("link", { name: "Feature flags" })).toHaveCount(0);

    await page.goto("/admin/feature-flags");
    expect(new URL(page.url()).pathname, "LEAK: the flags page loaded without the permission")
      .toBe("/admin");
    await expect(page.getByText("What is switched on.")).toHaveCount(0);
  });

  test("a holder sees the link, the page, and can flip a flag", async ({ page }) => {
    await signIn(page, holder);
    await expect(page.getByRole("link", { name: "Feature flags" })).toBeVisible();

    await page.goto("/admin/feature-flags");
    expect(new URL(page.url()).pathname).toBe("/admin/feature-flags");

    const row = page.locator("li", { hasText: flagKey }).first();
    await expect(row).toBeVisible();
    await expect(row.getByText("Currently off")).toBeVisible();

    await row.getByRole("button", { name: "Turn on" }).click();
    await expect(page.getByRole("status")).toContainText("Turned on", { timeout: 15_000 });

    const { data } = await db!.from("feature_flags")
      .select("enabled, updated_by").eq("key", flagKey).single();
    expect(data?.enabled, "the flag did not actually flip").toBe(true);
    expect(data?.updated_by, "the changer must be recorded").toBe(holder.id);

    const { data: log } = await db!.from("admin_audit_log")
      .select("action, admin_user_id").eq("target_id", flagKey)
      .eq("action", "feature_flag.enabled").maybeSingle();
    expect(log, "no audit row for the change").not.toBeNull();
    expect(log?.admin_user_id).toBe(holder.id);
  });

  test("revoking the permission stops the action, with the form already rendered", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, holder);
    await page.goto("/admin/feature-flags");
    const row = page.locator("li", { hasText: flagKey }).first();
    await expect(row).toBeVisible();

    // Take the permission away with the form still on screen.
    const { error } = await db!.from("admin_role_permissions").delete()
      .eq("role_id", holderRole).eq("permission", "feature_flags");
    expect(error, "failed to revoke the fixture permission").toBeNull();

    const before = (await db!.from("feature_flags").select("enabled").eq("key", flagKey).single()).data;

    const button = row.getByRole("button", { name: /Turn (on|off)/ });
    await button.click();
    await page.waitForTimeout(3000);

    // THE ASSERTION IS THE ROW.
    const after = (await db!.from("feature_flags").select("enabled").eq("key", flagKey).single()).data;
    expect(after?.enabled, "LEAK: the flag moved after the permission was revoked")
      .toBe(before?.enabled);
  });
});
