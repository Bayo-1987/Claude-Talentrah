import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "../src/lib/supabase/types";

/**
 * /admin/operators — the guard, and the trail.
 *
 * tests/rls/admin-roles.test.ts proves the DATABASE refuses the wrong things.
 * This proves the two things only a browser can:
 *
 *   1. A STANDARD ADMIN IS REFUSED AT THE URL, not merely un-linked. Hiding
 *      the nav entry is UX; a link you cannot see is still a URL you can type,
 *      and if requireSuperAdmin() were ever dropped from the page this is the
 *      test that notices.
 *   2. A role change lands in admin_audit_log. That write happens in the
 *      Server Action, above the database function, so no SQL-level test
 *      reaches it.
 */
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const configured = Boolean(URL_ && SERVICE);

if (process.env.CI && !configured) {
  throw new Error("admin-operators spec cannot run in CI: missing Supabase URL or service-role key");
}

const db: SupabaseClient<Database> | null = configured
  ? createClient<Database>(URL_!, SERVICE!, { auth: { persistSession: false } })
  : null;

interface Fixture { id: string; email: string; password: string }

async function makeOperator(role: "super_admin" | "standard"): Promise<Fixture> {
  const email = `e2e-operator-${role}-${randomUUID()}@talentrah.test`;
  const password = `E2E-${randomUUID()}Aa1!`;
  const { data, error } = await db!.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`fixture user: ${error.message}`);
  /*
   * role_id, not just the text column. 0075 decides permissions from role_id;
   * a fixture setting only `role` holds NOTHING, so the operator signs in and
   * every page bounces them — which is exactly how this spec failed the first
   * time it met 0075.
   */
  const { data: roleRow, error: roleErr } = await db!
    .from("admin_roles")
    .select("id")
    .eq("name", role === "super_admin" ? "Super Admin" : "Standard Admin")
    .single();
  if (roleErr) throw new Error(`fixture role lookup: ${roleErr.message}`);

  const { error: rowError } = await db!
    .from("admin_users")
    .insert({ id: data.user.id, email, display_name: `E2E ${role}`, role, role_id: roleRow.id });
  if (rowError) throw new Error(`fixture operator: ${rowError.message}`);
  return { id: data.user.id, email, password };
}

async function signIn(page: import("@playwright/test").Page, f: Fixture) {
  await page.goto("/admin/login");
  await page.locator("#admin-email").fill(f.email);
  await page.locator("#admin-password").fill(f.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Wait for the sign-in to actually land. Without this the caller's next
  // navigation races the Server Action and gets bounced back to the login
  // page — which then fails several assertions later, pointing at the wrong
  // thing entirely.
  await page.waitForURL((u) => !u.pathname.startsWith("/admin/login"), { timeout: 30_000 });
}

test.describe("operator management", () => {
  test.skip(!configured, "needs the Supabase URL and service-role key");

  let sup: Fixture, std: Fixture, victim: Fixture;

  test.beforeAll(async () => {
    sup = await makeOperator("super_admin");
    std = await makeOperator("standard");
    victim = await makeOperator("standard");
  });

  test.afterAll(async () => {
    const ids = [sup?.id, std?.id, victim?.id].filter(Boolean) as string[];
    if (!ids.length || !db) return;
    // Audit rows are ON DELETE SET NULL — clear them by id BEFORE the cascade
    // takes the id away. A refused delete RESOLVES with an error.
    const { error: auditError } = await db.from("admin_audit_log").delete().in("admin_user_id", ids);
    if (auditError) console.error("[operators cleanup] audit:", auditError.message);
    for (const id of ids) {
      const { error } = await db.auth.admin.deleteUser(id);
      if (error) console.error("[operators cleanup] user:", error.message);
    }
  });

  test("a standard admin is refused at the URL, and never shown the link", async ({ page }) => {
    await signIn(page, std);

    // The link is not in the nav…
    await expect(page.getByRole("link", { name: "Operators" })).toHaveCount(0);

    // …and typing the URL anyway does not work. This is the assertion that
    // matters; the one above is a courtesy.
    await page.goto("/admin/operators");
    expect(new URL(page.url()).pathname).toBe("/admin");
    await expect(page.getByText("Who can get in, and what they can do.")).toHaveCount(0);
  });

  test("a super admin sees the page, changes a role, and the change is logged", async ({ page }) => {
    await signIn(page, sup);
    await expect(page.getByRole("link", { name: "Operators" })).toBeVisible();

    await page.goto("/admin/operators");
    expect(new URL(page.url()).pathname).toBe("/admin/operators");

    const row = page.locator("li", { hasText: victim.email }).first();
    await expect(row).toBeVisible();

    /*
     * The role select's VALUE, not the text "Standard Admin" — since 0075 the
     * row contains that string twice, once as the operator's current role and
     * once as an option in the select. Asserting on the text hit both and
     * failed strict mode; asserting on the control says what is actually meant.
     */
    const select = row.getByLabel("Role");
    await expect(select).toHaveValue(/.+/);

    const { data: superRole } = await db!
      .from("admin_roles").select("id").eq("name", "Super Admin").single();
    await select.selectOption(superRole!.id);
    await row.getByRole("button", { name: "Save role" }).click();
    await expect(page.getByRole("status")).toContainText("Saved", { timeout: 15_000 });

    // The database agrees with the screen.
    const { data: after } = await db!
      .from("admin_users").select("role, role_id").eq("id", victim.id).single();
    expect(after?.role_id).toBe(superRole!.id);
    // The deprecated text column is kept in step by the same statement.
    expect(after?.role).toBe("super_admin");

    // And the trail names who did it. This write lives in the Server Action,
    // not the database function, so nothing below this layer can assert it.
    const { data: log } = await db!
      .from("admin_audit_log")
      .select("action, admin_user_id, admin_email, target_id, detail")
      .eq("target_id", victim.id)
      .eq("action", "operator.role_changed")
      .maybeSingle();
    expect(log, "no audit row for the role change").not.toBeNull();
    expect(log?.admin_user_id).toBe(sup.id);
    expect(log?.admin_email).toBe(sup.email);
    expect((log?.detail as { role_id?: string } | null)?.role_id).toBe(superRole!.id);
  });
});
