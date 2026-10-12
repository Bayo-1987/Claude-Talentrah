/**
 * Admin > Operators > an operator's row (role select + Save role, Disable / Re-enable): the form rule (QA, 9 Oct). Save a role twice in a row (success message each time, the database agrees),
 * Disable then Re-enable, then once with a deliberate error (the actor demotes themself to a role without Operators while they are the only holder: refused): the error is shown, the
 * database is untouched, and the choice in the select is still what was picked. Local stack only; throwaway operators, real /admin/login.
 */
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/types";
import { fakeSecret } from "../tests/support/fake-secret";
import { runCleanups } from "../tests/support/teardown";
import { acquireOperatorsLock } from "../tests/support/operators-lock";
import { submitAndSettle } from "./support/form-keeps";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (process.env.CI && !(URL_ && SERVICE)) throw new Error("admin-operator-row-form-rule cannot run in CI: missing Supabase URL or service-role key");
const db = URL_ && SERVICE ? createClient<Database>(URL_, SERVICE, { auth: { persistSession: false } }) : null;

const tag = randomUUID().slice(0, 8);
const actor = { id: "", email: `qa-oprow-actor-${tag}@talentrah.test`, password: fakeSecret("password") };
const victim = { id: "", email: `qa-oprow-victim-${tag}@talentrah.test`, password: fakeSecret("password") };
const roles = { ops: "", blog: "", courses: "" };

test.describe("admin: operator row form rule", () => {
  test.skip(!db, "needs the Supabase URL and service-role key");
  let release: () => Promise<void> = async () => {};

  test.beforeAll(async () => {
    release = await acquireOperatorsLock(db!, "e2e-admin-operator-row-form-rule");
    const mk = async (name: string, perm: "operators" | "blog" | "courses") => {
      const { data: r, error } = await db!.from("admin_roles").insert({ name }).select("id").single();
      if (error || !r) throw new Error(`fixture role: ${error?.message}`);
      const { error: pErr } = await db!.from("admin_role_permissions").insert({ role_id: r.id, permission: perm });
      if (pErr) throw new Error(`fixture permission: ${pErr.message}`);
      return r.id;
    };
    roles.ops = await mk(`e2e-oprow-ops ${tag}`, "operators");
    roles.blog = await mk(`e2e-oprow-blog ${tag}`, "blog");
    roles.courses = await mk(`e2e-oprow-courses ${tag}`, "courses");
    for (const [who, role, name] of [[actor, roles.ops, "QA Row Actor"], [victim, roles.blog, "QA Row Victim"]] as const) {
      const { data: u, error } = await db!.auth.admin.createUser({ email: who.email, password: who.password, email_confirm: true });
      if (error || !u) throw new Error(`fixture user: ${error?.message}`);
      who.id = u.user.id;
      const { error: rErr } = await db!.from("admin_users").insert({ id: who.id, email: who.email, display_name: name, role_id: role });
      if (rErr) throw new Error(`fixture operator: ${rErr.message}`);
    }
  });

  test.afterAll(async () => {
    await runCleanups(
      ["audit rows", async () => { await db!.from("admin_audit_log").delete().in("admin_user_id", [actor.id, victim.id]); }],
      ["operator rows", async () => { await db!.from("admin_users").delete().in("id", [actor.id, victim.id]); }],
      ["actor auth user", async () => { const { error } = await db!.auth.admin.deleteUser(actor.id); if (error) throw new Error(error.message); }],
      ["victim auth user", async () => { const { error } = await db!.auth.admin.deleteUser(victim.id); if (error) throw new Error(error.message); }],
      ["roles", async () => { const { error } = await db!.from("admin_roles").delete().in("id", Object.values(roles)); if (error) throw new Error(error.message); }],
      ["operators lock", async () => { await release(); }],
    );
  });

  test("save a role twice, disable and re-enable, then a refused change keeps the choice", async ({ page }, info) => {
    test.setTimeout(150_000);
    const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await page.goto("/admin/login");
    await page.locator("#admin-email").fill(actor.email);
    await page.locator("#admin-password").fill(actor.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/admin/login"), { timeout: 30_000 });
    await page.goto("/admin/operators");

    const row = (email: string) => page.locator("li", { hasText: email }).filter({ has: page.getByRole("button", { name: "Save role" }) }).last();
    const roleOf = async (id: string) => (await db!.from("admin_users").select("role_id, disabled_at").eq("id", id).single()).data;
    const save = async (email: string, roleId: string) => {
      const r = row(email);
      await r.getByLabel("Role").selectOption(roleId);
      await submitAndSettle(page, () => r.getByRole("button", { name: "Save role" }).click());
    };

    await save(victim.email, roles.courses);
    await expect(row(victim.email).getByRole("status")).toContainText("Saved", { timeout: 30_000 });
    await shot("1-first-save");
    expect((await roleOf(victim.id))?.role_id).toBe(roles.courses);
    await save(victim.email, roles.blog);
    await expect.poll(async () => (await roleOf(victim.id))?.role_id, { timeout: 30_000 }).toBe(roles.blog);
    await expect(row(victim.email).getByLabel("Role")).toHaveValue(roles.blog);
    await expect(row(victim.email).getByRole("status")).toContainText("Saved");

    // Disable then Re-enable: each shows a message and the database agrees.
    await submitAndSettle(page, () => row(victim.email).getByRole("button", { name: "Disable" }).click());
    await expect.poll(async () => (await roleOf(victim.id))?.disabled_at, { timeout: 30_000 }).not.toBeNull();
    await expect(row(victim.email).getByRole("status")).toContainText("Saved");
    await submitAndSettle(page, () => row(victim.email).getByRole("button", { name: "Re-enable" }).click());
    await expect.poll(async () => (await roleOf(victim.id))?.disabled_at, { timeout: 30_000 }).toBeNull();
    await page.waitForTimeout(500);

    // Deliberate error: the actor (the only holder of Operators) moves themself to a role without it.
    await save(actor.email, roles.courses);
    await expect(row(actor.email).getByRole("status")).toContainText("nobody able to manage operators", { timeout: 30_000 });
    await shot("3-refused");
    expect((await roleOf(actor.id))?.role_id, "database untouched").toBe(roles.ops);
    await expect(row(actor.email).getByLabel("Role"), "the refused choice stays in the select").toHaveValue(roles.courses);
  });
});
