/**
 * Admin > Operators > Invite an operator: the form rule (QA, owner admin scope 8 Oct): invite twice in a row (the second entry starts clean), then once with a deliberate
 * error (inviting an address that is already an operator): the error is shown and what was typed is still in the form. Local stack only: invitations go to the local mail
 * catcher, nobody real is emailed. A throwaway operator (own role holding only "operators", generated password) signs in through the real /admin/login page; a second
 * throwaway role is the one the invitees are given. The database is read back (admin_users rows). Screenshots at each step.
 */
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/types";
import { fakeSecret } from "../tests/support/fake-secret";
import { runCleanups } from "../tests/support/teardown";
import { acquireOperatorsLock } from "../tests/support/operators-lock";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (process.env.CI && !(URL_ && SERVICE)) throw new Error("admin-operators-invite-form-rule cannot run in CI: missing Supabase URL or service-role key");
const db = URL_ && SERVICE ? createClient<Database>(URL_, SERVICE, { auth: { persistSession: false } }) : null;

const tag = randomUUID().slice(0, 8);
const op = { id: "", email: `qa-inv-admin-${tag}@talentrah.test`, password: fakeSecret("password"), roleId: "" };
let targetRoleId = "";
const invitees = [`qa-invitee-a-${tag}@talentrah.test`, `qa-invitee-b-${tag}@talentrah.test`];

async function fill(page: Page, email: string, name: string) {
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Display name").fill(name);
  await page.locator("#invite-role").selectOption(targetRoleId);
}
const values = (page: Page) => page.evaluate(() => ({ email: (document.querySelector("#invite-email") as HTMLInputElement).value, name: (document.querySelector("#invite-name") as HTMLInputElement).value, role: (document.querySelector("#invite-role") as HTMLSelectElement).value }));

test.describe("admin: invite an operator form rule", () => {
  test.skip(!db, "needs the Supabase URL and service-role key");
  let release: () => Promise<void> = async () => {};

  test.beforeAll(async () => {
    release = await acquireOperatorsLock(db!, "e2e-admin-operators-invite-form-rule");
    const mk = async (name: string, perm: "operators" | "blog") => {
      const { data: role, error } = await db!.from("admin_roles").insert({ name }).select("id").single();
      if (error || !role) throw new Error(`fixture role: ${error?.message}`);
      const { error: pErr } = await db!.from("admin_role_permissions").insert({ role_id: role.id, permission: perm });
      if (pErr) throw new Error(`fixture permission: ${pErr.message}`);
      return role.id;
    };
    op.roleId = await mk(`e2e-invop ${tag}`, "operators");
    targetRoleId = await mk(`e2e-invtarget ${tag}`, "blog");
    const { data: u, error: uErr } = await db!.auth.admin.createUser({ email: op.email, password: op.password, email_confirm: true });
    if (uErr || !u) throw new Error(`fixture user: ${uErr?.message}`);
    op.id = u.user.id;
    const { error: rErr } = await db!.from("admin_users").insert({ id: op.id, email: op.email, display_name: "QA Invite Operator", role_id: op.roleId });
    if (rErr) throw new Error(`fixture operator: ${rErr.message}`);
  });

  test.afterAll(async () => {
    await runCleanups(
      ["invitee rows", async () => {
        for (const email of invitees) {
          const { data: rows } = await db!.from("admin_users").select("id").eq("email", email);
          for (const r of rows ?? []) {
            await db!.from("admin_audit_log").delete().eq("admin_user_id", r.id);
            await db!.from("admin_users").delete().eq("id", r.id);
            await db!.auth.admin.deleteUser(r.id);
          }
        }
      }],
      ["audit rows for the operator", async () => { await db!.from("admin_audit_log").delete().eq("admin_user_id", op.id); }],
      ["operator admin_users row", async () => { await db!.from("admin_users").delete().eq("id", op.id); }],
      ["operator auth user", async () => { const { error } = await db!.auth.admin.deleteUser(op.id); if (error) throw new Error(error.message); }],
      ["roles", async () => { await db!.from("admin_roles").delete().in("id", [op.roleId, targetRoleId]); }],
      ["operators lock", async () => { await release(); }],
    );
  });

  test("invite two operators in a row, then an already-invited address keeps what was typed", async ({ page }, info) => {
    test.setTimeout(150_000);
    const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await page.goto("/admin/login");
    await page.locator("#admin-email").fill(op.email);
    await page.locator("#admin-password").fill(op.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/admin/login"), { timeout: 30_000 });
    await page.goto("/admin/operators");

    await fill(page, invitees[0], "QA Invitee A");
    await shot("1-first-invite-filled");
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByRole("status").filter({ hasText: /\S/ }).first()).toBeVisible({ timeout: 30_000 });
    await shot("2-after-first-invite");
    const afterFirst = await values(page);
    expect([afterFirst.email, afterFirst.name], `the form must be empty after a successful invite: ${JSON.stringify(afterFirst)}`).toEqual(["", ""]);

    await fill(page, invitees[1], "QA Invitee B");
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect.poll(async () => (await db!.from("admin_users").select("id").eq("email", invitees[1])).data?.length ?? 0, { timeout: 30_000 }).toBe(1);
    await expect(page.getByRole("button", { name: "Send invitation" })).toBeEnabled({ timeout: 30_000 }); // the action has finished and the form has settled
    await page.waitForTimeout(500);
    const afterSecond = await values(page);
    expect([afterSecond.email, afterSecond.name], `the form must be empty after the second invite: ${JSON.stringify(afterSecond)}`).toEqual(["", ""]);
    expect((await db!.from("admin_users").select("id").eq("email", invitees[0])).data).toHaveLength(1);

    // Deliberate error: invite an address that is already an operator.
    await fill(page, invitees[0], "QA Invitee A again");
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByRole("status").filter({ hasText: /\S/ }).first()).toBeVisible({ timeout: 30_000 });
    await shot("3-already-invited-error");
    const kept = await values(page);
    expect(kept, "the error must keep what was typed").toEqual({ email: invitees[0], name: "QA Invitee A again", role: targetRoleId });
    expect((await db!.from("admin_users").select("id").eq("email", invitees[0])).data, "no second row for the same address").toHaveLength(1);
  });
});
