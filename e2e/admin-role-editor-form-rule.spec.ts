/**
 * Admin > Operators > Roles: the form rule (QA, 9 Oct). Create two roles in a row (the create form starts clean after each), rename an existing role twice in a row, then once with a
 * deliberate error (a name already taken) on BOTH the create form and the rename form: the error is shown and what was typed (name and ticked permissions) is still in the form.
 * Also: a success shows a message. Local stack only; a throwaway operator holding only "operators" signs in through the real /admin/login page. The database is read back.
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
if (process.env.CI && !(URL_ && SERVICE)) throw new Error("admin-role-editor-form-rule cannot run in CI: missing Supabase URL or service-role key");
const db = URL_ && SERVICE ? createClient<Database>(URL_, SERVICE, { auth: { persistSession: false } }) : null;

const tag = randomUUID().slice(0, 8);
const op = { id: "", email: `qa-roleed-${tag}@talentrah.test`, password: fakeSecret("password"), roleId: "" };
const names = { a: `e2e-qa-role-a ${tag}`, b: `e2e-qa-role-b ${tag}`, c: `e2e-qa-role-c ${tag}`, a2: `e2e-qa-role-a-renamed ${tag}`, a3: `e2e-qa-role-a-renamed-again ${tag}` };

const createCard = (page: Page) => page.locator("li", { has: page.locator("#role-name-new-role") });
const state = async (page: Page, id: string) => page.evaluate((rid) => {
  const name = (document.getElementById(`role-name-${rid}`) as HTMLInputElement | null)?.value ?? null;
  const form = document.getElementById(`role-name-${rid}`)?.closest("form");
  const ticked = Array.from(form?.querySelectorAll<HTMLInputElement>('input[name="permissions"]:checked') ?? []).map((i) => i.value).sort();
  return { name, ticked };
}, id);

test.describe("admin: role editor form rule", () => {
  test.skip(!db, "needs the Supabase URL and service-role key");
  let release: () => Promise<void> = async () => {};

  test.beforeAll(async () => {
    release = await acquireOperatorsLock(db!, "e2e-admin-role-editor-form-rule");
    const { data: role, error } = await db!.from("admin_roles").insert({ name: `e2e-roleed-op ${tag}` }).select("id").single();
    if (error || !role) throw new Error(`fixture role: ${error?.message}`);
    op.roleId = role.id;
    const { error: pErr } = await db!.from("admin_role_permissions").insert({ role_id: role.id, permission: "operators" });
    if (pErr) throw new Error(`fixture permission: ${pErr.message}`);
    const { data: u, error: uErr } = await db!.auth.admin.createUser({ email: op.email, password: op.password, email_confirm: true });
    if (uErr || !u) throw new Error(`fixture user: ${uErr?.message}`);
    op.id = u.user.id;
    const { error: rErr } = await db!.from("admin_users").insert({ id: op.id, email: op.email, display_name: "QA Role Operator", role_id: op.roleId });
    if (rErr) throw new Error(`fixture operator: ${rErr.message}`);
  });

  test.afterAll(async () => {
    await runCleanups(
      ["audit rows", async () => { await db!.from("admin_audit_log").delete().eq("admin_user_id", op.id); }],
      ["operator row", async () => { await db!.from("admin_users").delete().eq("id", op.id); }],
      ["operator auth user", async () => { const { error } = await db!.auth.admin.deleteUser(op.id); if (error) throw new Error(error.message); }],
      ["roles", async () => {
        const { data } = await db!.from("admin_roles").select("id").like("name", `%${tag}`);
        const { error } = await db!.from("admin_roles").delete().in("id", (data ?? []).map((r) => r.id));
        if (error) throw new Error(error.message);
      }],
      ["operators lock", async () => { await release(); }],
    );
  });

  async function signIn(page: Page) {
    await page.goto("/admin/login");
    await page.locator("#admin-email").fill(op.email);
    await page.locator("#admin-password").fill(op.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/admin/login"), { timeout: 30_000 });
    await page.goto("/admin/operators");
  }

  // RED on main (ROLE-CREATE-1): the create form always answers "Something went wrong on our end." because the Server Action omits p_role_id and the database function has no default for it (PGRST202).
  test("create twice in a row starts clean; a taken name keeps what was typed", async ({ page }, info) => {
    test.setTimeout(120_000);
    const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await signIn(page);
    const create = async (name: string, perms: string[]) => {
      const card = createCard(page);
      await card.locator("#role-name-new-role").fill(name);
      for (const p of perms) await card.locator(`input[name="permissions"][value="${p}"]`).check();
      await submitAndSettle(page, () => card.getByRole("button", { name: "Create role" }).click());
    };
    await create(names.a, ["blog", "feedback"]);
    await shot("1-first-create");
    await expect(createCard(page).getByRole("status")).toContainText(`Created ${names.a}`, { timeout: 30_000 });
    expect(await state(page, "new-role"), "create form must be empty after a successful create").toEqual({ name: "", ticked: [] });
    await create(names.b, ["courses"]);
    await expect(createCard(page).getByRole("status")).toContainText(`Created ${names.b}`, { timeout: 30_000 });
    expect(await state(page, "new-role"), "create form must be empty after the second create").toEqual({ name: "", ticked: [] });
    expect((await db!.from("admin_roles").select("id").in("name", [names.a, names.b])).data).toHaveLength(2);
    await create(names.a, ["finance", "people"]);
    await expect(createCard(page).getByRole("status")).toContainText("already exists", { timeout: 30_000 });
    await shot("3-create-name-taken");
    expect(await state(page, "new-role"), "create error must keep what was typed").toEqual({ name: names.a, ticked: ["finance", "people"] });
  });

  test("rename twice in a row; a taken name keeps what was typed", async ({ page }, info) => {
    test.setTimeout(120_000);
    const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    const mk = async (name: string, perm: "blog" | "courses") => {
      const { data: r, error } = await db!.from("admin_roles").insert({ name }).select("id").single();
      if (error || !r) throw new Error(`fixture role: ${error?.message}`);
      await db!.from("admin_role_permissions").insert({ role_id: r.id, permission: perm });
      return r.id;
    };
    const roleA = await mk(`e2e-qa-rename-a ${tag}`, "blog");
    await mk(names.c, "courses");
    await signIn(page);
    const input = () => page.locator(`#role-name-${roleA}`);
    const status = () => input().locator("xpath=ancestor::li[1]").getByRole("status");
    const rename = async (to: string) => {
      await input().fill(to);
      await submitAndSettle(page, () => input().locator("xpath=ancestor::form").getByRole("button", { name: "Save role" }).click());
    };
    await rename(names.a2);
    await expect(status()).toContainText("Role saved", { timeout: 30_000 });
    await shot("4-first-rename");
    await rename(names.a3);
    await expect.poll(async () => (await db!.from("admin_roles").select("name").eq("id", roleA).single()).data?.name, { timeout: 30_000 }).toBe(names.a3);
    await expect(page.getByRole("button", { name: "Save role" }).first()).toBeEnabled();
    await page.waitForTimeout(500); // the form has settled (React resets it after the action finishes)
    expect((await db!.from("admin_roles").select("name").eq("id", roleA).single()).data?.name).toBe(names.a3);
    await expect(input()).toHaveValue(names.a3);

    await input().fill(names.c);
    const form = input().locator("xpath=ancestor::form");
    await form.locator('input[name="permissions"][value="people"]').check();
    const before = await state(page, roleA);
    await submitAndSettle(page, () => form.getByRole("button", { name: "Save role" }).click());
    await expect(status()).toContainText("already exists", { timeout: 30_000 });
    await shot("6-rename-name-taken");
    expect(await state(page, roleA), "rename error must keep what was typed").toEqual({ ...before, name: names.c });
    expect((await db!.from("admin_roles").select("name").eq("id", roleA).single()).data?.name, "database untouched").toBe(names.a3);
  });
});
